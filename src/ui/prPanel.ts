/**
 * 「集市 PR」页签
 *
 * 列出 siyuan-note/bazaar 的拉取请求（默认开放中，可切换已关闭），显示标签（含 CI 状态），
 * 可在浏览器打开 PR 页面；带 `ci-passed` 标签的行可一键安装 —— 点击后打开安装页签并载入该 PR
 * 的包仓库地址，版本由安装面板按最新 Release 解析
 */

import { Custom } from "siyuan";
import {
    getBazaarPullInstallTarget,
    isBazaarPullCIPassed,
    listBazaarPulls,
    ownerRepoFromBazaarPullTitle,
    type BazaarPullRow,
    type BazaarPullState,
} from "../github/bazaarPrs";
import { i18n } from "../infra/i18n";
import { safeExternalUrl } from "../infra/html";
import { message } from "../infra/message";
import { createBazaarPullLabelChip } from "./bazaarPullLabels";
import { setStatusText } from "./installedPackageUi";
import { createConsoleLogger, type Logger } from "./logger";
import type { InstallPanelPreset } from "./panel";

/** 滚动到距底部该距离时自动加载下一页 */
const LOAD_MORE_THRESHOLD_PX = 120;

/** ISO 时间转本地日期；无法解析时返回空串 */
function formatDate(iso: string): string {
    const time = Date.parse(iso);
    return Number.isFinite(time) ? new Date(time).toLocaleDateString() : "";
}

function renderBazaarPrPanel(root: HTMLElement): void {
    root.classList.add("jcip-tab");
    root.innerHTML = `
    <div class="jcip-pr">
        <div class="jcip-pr__toolbar">
            <button type="button" class="b3-button b3-button--outline" data-type="pr-state" data-state="open">${i18n.bazaarPrStateOpen}</button>
            <button type="button" class="b3-button b3-button--outline" data-type="pr-state" data-state="closed">${i18n.bazaarPrStateClosed}</button>
            <span class="jcip-pr__toolbar-space"></span>
            <button type="button" class="b3-button b3-button--outline" data-type="pr-refresh">${i18n.bazaarPrRefresh}</button>
        </div>
        <div class="jcip-pr__list">
            <div class="jcip-pr__items" data-type="pr-items"></div>
            <p class="jcip-pr__status" data-type="pr-status"></p>
        </div>
    </div>`;
}

/** 一行的标签胶囊：色点取自标签自身颜色，两种主题下都能看清 */
export class BazaarPrPanel {
    private readonly root: HTMLElement;
    private readonly log: Logger;
    private readonly listEl: HTMLDivElement;
    private readonly itemsEl: HTMLDivElement;
    private readonly statusEl: HTMLParagraphElement;
    private readonly stateEls: HTMLButtonElement[];
    private readonly refreshEl: HTMLButtonElement;
    /** 打开安装页签并载入目标；只用于带 `ci-passed` 标签的行 */
    private readonly openInstallTab: (preset: InstallPanelPreset) => void;
    private state: BazaarPullState = "open";
    private rows: BazaarPullRow[] = [];
    private nextPage = 1;
    private hasMore = true;
    private loading = false;
    /** 本页加载失败：在刷新前不再自动请求，避免滚动时反复重试 */
    private loadFailed = false;
    /** 加载序号：切换状态或刷新后作废在途回调 */
    private loadSeq = 0;
    private loadAbort: AbortController | undefined;
    /** 正在解析安装目标的 PR；期间忽略安装键的点击 */
    private resolving: number | undefined;
    private resolveAbort: AbortController | undefined;

    constructor(custom: Custom, openInstallTab: (preset: InstallPanelPreset) => void) {
        this.root = custom.element as HTMLElement;
        renderBazaarPrPanel(this.root);
        this.listEl = this.root.querySelector(".jcip-pr__list") as HTMLDivElement;
        this.itemsEl = this.root.querySelector("div[data-type='pr-items']") as HTMLDivElement;
        // 状态行在列表框内部（列表为空或加载下一页时显示在行下方）
        this.statusEl = this.root.querySelector("p[data-type='pr-status']") as HTMLParagraphElement;
        this.refreshEl = this.root.querySelector("button[data-type='pr-refresh']") as HTMLButtonElement;
        this.stateEls = Array.from(this.root.querySelectorAll<HTMLButtonElement>("button[data-type='pr-state']"));
        this.log = createConsoleLogger();
        this.openInstallTab = openInstallTab;

        this.listEl.addEventListener("click", (event) => {
            this.onListClick(event);
        });
        this.listEl.addEventListener("scroll", () => {
            this.onListScroll();
        });
        for (const el of this.stateEls) {
            el.addEventListener("click", () => {
                this.switchState(el.dataset.state);
            });
        }
        this.refreshEl.addEventListener("click", () => {
            this.reload();
        });

        this.syncStateButtons();
        this.reload();
    }

    destroy(): void {
        this.loadSeq++;
        this.loadAbort?.abort();
        this.loadAbort = undefined;
        this.resolveAbort?.abort();
        this.resolveAbort = undefined;
    }

    private switchState(raw: string | undefined): void {
        const state: BazaarPullState = raw === "closed" ? "closed" : "open";
        if (state === this.state) {
            return;
        }
        this.state = state;
        this.syncStateButtons();
        this.reload();
    }

    /** 当前视图的按钮用实心、另一个用描边，便于一眼看出在看哪一种 */
    private syncStateButtons(): void {
        for (const el of this.stateEls) {
            el.classList.toggle("b3-button--outline", el.dataset.state !== this.state);
        }
    }

    private reload(): void {
        this.loadSeq++;
        this.loadAbort?.abort();
        this.loadAbort = new AbortController();
        // 视图已变，在途的安装目标解析随之失效，避免切走之后仍然打开安装页签
        this.resolveAbort?.abort();
        this.resolveAbort = undefined;
        this.resolving = undefined;
        this.rows = [];
        this.nextPage = 1;
        this.hasMore = true;
        this.loading = false;
        this.loadFailed = false;
        this.renderList();
        this.setStatus(i18n.bazaarPrLoading, false);
        void this.loadNextPage(this.loadSeq);
    }

    private async loadNextPage(seq: number): Promise<void> {
        if (this.loading || !this.hasMore || this.loadFailed || seq !== this.loadSeq) {
            return;
        }
        const abort = this.loadAbort;
        if (abort === undefined) {
            return;
        }
        this.loading = true;
        const page = await listBazaarPulls(this.state, this.nextPage, this.log, abort.signal);
        if (seq !== this.loadSeq) {
            return;
        }
        this.loading = false;
        if (page === null) {
            this.loadFailed = true;
            this.setStatus(i18n.bazaarPrLoadingFailed, true);
            return;
        }
        this.rows.push(...page.rows);
        this.nextPage++;
        this.hasMore = page.pageFull;
        this.renderList();
        // 到底时不提示，避免列表下方多出一行「没有更多了」
        this.setStatus(this.rows.length === 0 ? i18n.bazaarPrEmpty : "", false);
    }

    private onListScroll(): void {
        if (this.resolving !== undefined || this.loading || !this.hasMore || this.loadFailed) {
            return;
        }
        const { scrollTop, clientHeight, scrollHeight } = this.listEl;
        if (scrollTop + clientHeight >= scrollHeight - LOAD_MORE_THRESHOLD_PX) {
            void this.loadNextPage(this.loadSeq);
        }
    }

    private setStatus(text: string, isError: boolean): void {
        setStatusText(this.statusEl, text, isError, "jcip-pr__status--error");
    }
    private onListClick(event: Event): void {
        const target = event.target instanceof Element ? event.target.closest("button[data-type='install']") : null;
        if (!(target instanceof HTMLButtonElement)) {
            return;
        }
        const number = Number(target.closest(".jcip-pr__item")?.getAttribute("data-number"));
        if (!Number.isFinite(number)) {
            return;
        }
        void this.openInstallPanel(number);
    }

    /**
     * 打开安装页签并载入该 PR 的包仓库
     *
     * 只带仓库地址：版本交由安装面板按最新 Release 解析，因此无需取检查评论里的 tag。
     * 同一时刻只处理一次点击，其余请求直接忽略，避免连点打开多个页签
     */
    private async openInstallPanel(number: number): Promise<void> {
        if (this.resolving !== undefined) {
            return;
        }
        const row = this.rows.find((item) => item.number === number);
        if (row === undefined) {
            return;
        }
        const abort = new AbortController();
        this.resolving = number;
        this.resolveAbort = abort;
        this.markInstallButtonsBusy(number);
        try {
            const repo = await this.resolvePackageRepo(row, abort.signal);
            // 切换视图或关闭页签会中止解析，这属于预期取消，不是目标取不到
            if (abort.signal.aborted) {
                return;
            }
            if (repo === null) {
                message(i18n.bazaarPrInstallTargetFailed.replace("{number}", `#${row.number}`));
                return;
            }
            this.openInstallTab({
                url: `https://github.com/${repo}`,
                repoKey: repo,
                pull: {
                    number: row.number,
                    title: row.title,
                    htmlUrl: row.htmlUrl,
                    labels: row.labels,
                },
            });
        } catch (error) {
            this.log.warn("failed to open install tab for pull request:", error);
        } finally {
            // 已被新的解析顶替时（如又点了一次安装）交由新的那次收尾，避免清错状态
            if (this.resolveAbort === abort) {
                this.resolveAbort = undefined;
                this.resolving = undefined;
                this.markInstallButtonsBusy();
            }
        }
    }

    /**
     * 解析该 PR 对应的集市包仓库：优先用 PR Check 评论里的指纹，取不到时回退到标题
     *
     * 下架 / 弃用类 PR 也会带上 `ci-passed` 标签，但它们没有指纹、标题也不是 `Add owner/repo`，
     * 因此这里返回 null，由调用方提示该 PR 不能安装
     */
    private async resolvePackageRepo(row: BazaarPullRow, signal: AbortSignal): Promise<string | null> {
        const fromComment = await getBazaarPullInstallTarget(row.number, this.log, signal);
        if (fromComment !== null) {
            return fromComment.repo;
        }
        return ownerRepoFromBazaarPullTitle(row.title);
    }

    /** 解析目标期间禁用安装键并按行改写文案，避免连点；`activeNumber` 省略时恢复初始态 */
    private markInstallButtonsBusy(activeNumber?: number): void {
        const busy = activeNumber !== undefined;
        for (const el of this.listEl.querySelectorAll<HTMLButtonElement>("button[data-type='install']")) {
            el.disabled = busy;
            const isActive = el.closest(".jcip-pr__item")?.getAttribute("data-number") === String(activeNumber);
            el.textContent = busy && isActive ? i18n.bazaarPrInstallResolving : i18n.bazaarPrInstallButton;
        }
    }

    private renderList(): void {
        const fragment = document.createDocumentFragment();
        for (const row of this.rows) {
            fragment.append(this.renderItem(row));
        }
        this.itemsEl.replaceChildren(fragment);
    }

    private renderItem(row: BazaarPullRow): HTMLElement {
        const item = document.createElement("div");
        item.className = "jcip-pr__item";
        item.setAttribute("data-number", String(row.number));

        // 来自 GitHub 接口的地址（头像、PR 页面）只放行 http/https
        const htmlUrl = safeExternalUrl(row.htmlUrl);
        const avatarUrl = safeExternalUrl(row.authorAvatarUrl);
        if (avatarUrl !== "") {
            const avatar = document.createElement("img");
            avatar.className = "jcip-pr__avatar";
            avatar.src = avatarUrl;
            avatar.alt = "";
            avatar.loading = "lazy";
            avatar.decoding = "async";
            avatar.referrerPolicy = "no-referrer";
            item.append(avatar);
        }

        const main = document.createElement("div");
        main.className = "jcip-pr__main";
        const title = document.createElement("a");
        title.className = "jcip-pr__title";
        title.href = htmlUrl;
        title.target = "_blank";
        title.rel = "noopener noreferrer";
        title.textContent = `#${row.number} ${row.title}`;
        main.append(title);

        const meta = document.createElement("div");
        meta.className = "jcip-pr__meta";
        if (row.authorLogin !== "") {
            const author = document.createElement("span");
            author.className = "jcip-pr__author";
            author.textContent = row.authorLogin;
            meta.append(author);
        }
        const date = formatDate(row.updatedAt);
        if (date !== "") {
            const updated = document.createElement("span");
            updated.textContent = i18n.bazaarPrUpdated.replace("{date}", date);
            meta.append(updated);
        }
        if (row.state === "closed" && row.merged) {
            const merged = document.createElement("span");
            merged.className = "jcip-pr__merged";
            merged.textContent = i18n.bazaarPrMerged;
            meta.append(merged);
        }
        for (const label of row.labels) {
            meta.append(createBazaarPullLabelChip(label));
        }
        main.append(meta);
        item.append(main);

        const actions = document.createElement("div");
        actions.className = "jcip-pr__actions";
        if (htmlUrl !== "") {
            const open = document.createElement("a");
            open.className = "b3-button b3-button--outline";
            open.href = htmlUrl;
            open.target = "_blank";
            open.rel = "noopener noreferrer";
            open.textContent = i18n.bazaarPrOpenButton;
            actions.append(open);
        }
        if (isBazaarPullCIPassed(row)) {
            const install = document.createElement("button");
            install.type = "button";
            install.className = "b3-button";
            install.dataset.type = "install";
            install.textContent = i18n.bazaarPrInstallButton;
            actions.append(install);
        }
        item.append(actions);
        return item;
    }
}
