/**
 * 「本地集市包」页签
 *
 * 列出本工作空间已安装的集市包（插件、主题、图标、挂件、模板），按类型分页签，卡片式展示；
 * 点击卡片打开对应的安装页签（隐藏 URL 栏、版本栏回填已安装版本），卡片右下角可检查更新、卸载。
 * 更新检查按 GitHub Release 的最新 tag 与已安装版本比较，与本插件的安装流程口径一致
 */

import { Custom } from "siyuan";
import { getLatestReleaseTag } from "../github/github";
import { i18n } from "../infra/i18n";
import { comparePackageVersions } from "../install/packageVersion";
import {
    KERNEL_PACKAGE_TYPES,
    kernelPackageTypeLabel,
    listInstalledPackages,
    sortInstalledPackages,
    type InstalledPackage,
    type KernelPackageType,
} from "../install/installedPackages";
import { uninstallInstalledPackages } from "../install/uninstall";
import { BAZAAR_ICON_ID, REFRESH_ICON_ID, TRASHCAN_ICON_ID } from "./icons";
import {
    emptyPackagesText,
    iconButton,
    isUsablePackage,
    pickDefaultType,
    rowKey,
    setStatusText,
} from "./installedPackageUi";
import { createConsoleLogger, type Logger } from "../infra/logger";
import type { InstallPanelPreset } from "./panelData";

/** 更新检查结果；`unknown` 为版本号无法比较（如版本写法不是语义化版本） */
type PackageUpdateState =
    | { kind: "latest"; latestTag: string }
    | { kind: "outdated"; latestTag: string }
    | { kind: "unknown"; latestTag: string }
    | { kind: "failed" };

/**
 * 「全部检查更新」的并发数
 *
 * 并发是为了不让包多的用户干等；上限压得低一些，避免把 GitHub 接口的速率限制一次性打满
 */
const CHECK_ALL_CONCURRENCY = 4;

function renderInstalledPanel(root: HTMLElement): void {
    root.classList.add("jcip-tab");
    root.innerHTML = `
    <div class="jcip-local">
        <div class="jcip-local__toolbar">
            <div class="jcip-local__tabs" data-type="tabs"></div>
            <span class="jcip-local__toolbar-space"></span>
            <span class="jcip-local__progress" data-type="progress"></span>
            <button type="button" class="b3-button b3-button--outline" data-type="check-all">${i18n.installedCheckAll}</button>
            <button type="button" class="b3-button b3-button--outline" data-type="refresh">${i18n.installedRefresh}</button>
        </div>
        <div class="jcip-local__list">
            <div class="jcip-local__cards" data-type="cards"></div>
            <p class="jcip-local__status" data-type="status"></p>
        </div>
    </div>`;
}

export class InstalledPanel {
    private readonly root: HTMLElement;
    private readonly log: Logger;
    private readonly cardsEl: HTMLDivElement;
    private readonly tabsEl: HTMLDivElement;
    private readonly statusEl: HTMLParagraphElement;
    private readonly progressEl: HTMLElement;
    private readonly checkAllEl: HTMLButtonElement;
    /** 打开安装页签并载入目标；目标为本地集市包，面板只隐藏 URL 栏 */
    private readonly openInstallTab: (preset: InstallPanelPreset) => void;
    /** 插件自身包名：自身不能卸载 */
    private readonly pluginName: string;
    private packages: InstalledPackage[] = [];
    /** 当前查看的包类型；默认插件，若该类型为空则自动切到第一个有内容的类型 */
    private activeType: KernelPackageType = "plugins";
    /** 类型页签与其数量标记，键为内核类型 */
    private readonly tabEls = new Map<KernelPackageType, { tab: HTMLButtonElement; count: HTMLElement }>();
    /** 卡片内的更新状态展示位置，键同 `rowKey` */
    private readonly rowUpdateEls = new Map<string, HTMLSpanElement>();
    /** 卡片上的检查更新键，键同 `rowKey`；检查期间置为禁用 */
    private readonly rowCheckEls = new Map<string, HTMLButtonElement>();
    /** 各行的更新检查结果 */
    private readonly updateStates = new Map<string, PackageUpdateState>();
    /** 在途的检查请求，重新加载、中断检查或关闭页签时中止 */
    private readonly checkAborts = new Set<AbortController>();
    /** 已发起检查、尚未出结果的行 */
    private readonly checkingRows = new Set<string>();
    /** 「全部检查更新」是否在进行中；进行中时该键改作「中断检查」 */
    private checkingAll = false;
    /** 本轮全量检查的已完成后数量与总数，用于进度文案 */
    private checkAllDone = 0;
    private checkAllTotal = 0;
    /** 加载序号：刷新后作废在途回调 */
    private loadSeq = 0;
    /** 全量检查的世代号：中断或重新开始时作废上一轮还没跑完的分支 */
    private checkAllSeq = 0;
    private destroyed = false;

    constructor(custom: Custom, openInstallTab: (preset: InstallPanelPreset) => void, pluginName: string) {
        this.root = custom.element as HTMLElement;
        renderInstalledPanel(this.root);
        this.cardsEl = this.root.querySelector("div[data-type='cards']") as HTMLDivElement;
        this.tabsEl = this.root.querySelector("div[data-type='tabs']") as HTMLDivElement;
        // 状态行在列表框内部（列表为空或加载失败时显示在卡片下方）
        this.statusEl = this.root.querySelector("p[data-type='status']") as HTMLParagraphElement;
        this.progressEl = this.root.querySelector("[data-type='progress']") as HTMLElement;
        this.checkAllEl = this.root.querySelector("button[data-type='check-all']") as HTMLButtonElement;
        this.log = createConsoleLogger();
        this.openInstallTab = openInstallTab;
        this.pluginName = pluginName;

        // 卡片整体可点（内部按钮与链接除外）
        this.cardsEl.addEventListener("click", (event) => {
            void this.onCardsClick(event);
        });
        this.tabsEl.addEventListener("click", (event) => {
            this.onTabsClick(event);
        });
        this.checkAllEl.addEventListener("click", () => {
            void this.checkAll();
        });
        this.root.querySelector("button[data-type='refresh']")?.addEventListener("click", () => {
            void this.reload();
        });

        this.renderTabs();
        // 读列表之前先按「没有可检查项」把工具栏定下来
        this.syncToolbar();
        void this.reload();
    }

    destroy(): void {
        this.destroyed = true;
        this.loadSeq++;
        this.cancelChecks();
    }

    /** 中止全部在途的更新检查并清空其状态；同时作废「全部检查更新」还在排队的行 */
    private cancelChecks(): void {
        this.checkAllSeq++;
        this.checkingAll = false;
        for (const abort of this.checkAborts) {
            abort.abort();
        }
        this.checkAborts.clear();
        this.checkingRows.clear();
    }

    private async reload(): Promise<void> {
        const seq = ++this.loadSeq;
        this.cancelChecks();
        this.packages = [];
        this.updateStates.clear();
        this.syncTabs();
        this.renderCards();
        this.setStatus(i18n.installedLoading, false);
        const packages = await listInstalledPackages(this.log);
        if (seq !== this.loadSeq || this.destroyed) {
            return;
        }
        if (packages === null) {
            this.setStatus(i18n.installedLoadFailed, true);
            this.syncToolbar();
            return;
        }
        this.packages = packages;
        this.pickDefaultType();
        this.syncTabs();
        this.renderCards();
        this.setStatus(this.emptyStatusText(), false);
        this.syncToolbar();
    }

    /** 当前类型一个包都没有而其它类型有时，自动切到第一个有内容的类型，避免打开页就见到空列表 */
    private pickDefaultType(): void {
        this.activeType = pickDefaultType(this.packages, this.activeType);
    }

    /** 空列表提示：整个工作空间没有已安装包，或该类型下没有 */
    private emptyStatusText(): string {
        return emptyPackagesText(this.packages, this.activeType);
    }

    private onTabsClick(event: Event): void {
        const target = event.target instanceof Element ? event.target.closest("button[data-type='tab']") : null;
        if (!(target instanceof HTMLButtonElement)) {
            return;
        }
        const kernelType = target.dataset.kernelType as KernelPackageType | undefined;
        if (kernelType === undefined || kernelType === this.activeType) {
            return;
        }
        this.activeType = kernelType;
        this.syncTabs();
        this.renderCards();
        this.setStatus(this.emptyStatusText(), false);
    }

    private setStatus(text: string, isError: boolean): void {
        setStatusText(this.statusEl, text, isError, "jcip-local__status--error");
    }

    /** 可检查更新的行：有仓库来源且本地包正常 */
    private checkablePackages(): InstalledPackage[] {
        return this.packages.filter(isUsablePackage);
    }

    /** 检查进行中时该键改作「中断检查」；没有可检查项时禁用 */
    private syncToolbar(): void {
        this.checkAllEl.textContent = this.checkingAll ? i18n.installedAbortCheck : i18n.installedCheckAll;
        this.checkAllEl.disabled = !this.checkingAll && this.checkablePackages().length === 0;
        this.progressEl.textContent = this.checkingAll
            ? i18n.installedCheckAllProgress
                .replace("{done}", String(this.checkAllDone))
                .replace("{total}", String(this.checkAllTotal))
            : "";
        this.progressEl.classList.toggle("fn__none", !this.checkingAll);
    }

    /**
     * 检查全部可检查的行
     *
     * 按固定并发数同时跑：进行中时该键改作「中断检查」，点击后中止在途请求并停止排队
     */
    private async checkAll(): Promise<void> {
        if (this.checkingAll) {
            this.cancelChecks();
            this.syncToolbar();
            return;
        }
        const targets = this.checkablePackages();
        if (targets.length === 0) {
            return;
        }
        const seq = ++this.checkAllSeq;
        this.checkingAll = true;
        this.checkAllDone = 0;
        this.checkAllTotal = targets.length;
        this.syncToolbar();
        let next = 0;
        const worker = async (): Promise<void> => {
            while (seq === this.checkAllSeq && !this.destroyed) {
                const index = next++;
                if (index >= targets.length) {
                    return;
                }
                await this.checkOne(targets[index]);
                if (seq !== this.checkAllSeq) {
                    return;
                }
                this.checkAllDone++;
                this.syncToolbar();
            }
        };
        try {
            await Promise.all(
                Array.from({ length: Math.min(CHECK_ALL_CONCURRENCY, targets.length) }, () => worker()),
            );
        } finally {
            // 已被中断或顶替时由新的那一轮收尾，避免清错状态
            if (seq === this.checkAllSeq) {
                this.checkingAll = false;
                this.syncToolbar();
            }
        }
    }

    /** 检查单行的更新：取仓库最新 Release 的 tag 与已安装版本比较 */
    private async checkOne(pkg: InstalledPackage): Promise<void> {
        const key = rowKey(pkg);
        if (this.checkingRows.has(key) || pkg.repoKey === "") {
            return;
        }
        this.checkingRows.add(key);
        this.setCheckButtonBusy(key, true);
        const abort = new AbortController();
        this.checkAborts.add(abort);
        try {
            const latestTag = await this.fetchLatestTag(pkg.repoKey, abort.signal);
            if (abort.signal.aborted || this.destroyed) {
                // 被中断：不留半成品状态，回到「未检查」
                this.clearUpdateState(key);
                return;
            }
            this.setUpdateState(key, latestTag === null ? { kind: "failed" } : this.compareUpdate(pkg, latestTag));
        } finally {
            this.checkAborts.delete(abort);
            this.checkingRows.delete(key);
            this.setCheckButtonBusy(key, false);
        }
    }

    /** 检查期间禁用该行的图标按钮并让它转起来，避免连点（卡片可能在刷新后重建，取不到就算了） */
    private setCheckButtonBusy(key: string, busy: boolean): void {
        const button = this.rowCheckEls.get(key);
        if (button === undefined) {
            return;
        }
        button.disabled = busy;
        button.classList.toggle("jcip-local__check--busy", busy);
    }

    /** 最新 tag 与已安装版本的比较结果；版本号无法比较时如实说明，不谎称有新版本 */
    private compareUpdate(pkg: InstalledPackage, latestTag: string): PackageUpdateState {
        const compared = comparePackageVersions(latestTag, pkg.version);
        if (compared === null) {
            return { kind: "unknown", latestTag };
        }
        return compared > 0 ? { kind: "outdated", latestTag } : { kind: "latest", latestTag };
    }

    /** 仓库最新 Release 的 tag；没有正式版时回退为发布时间最新的 Release */
    private async fetchLatestTag(repoKey: string, signal: AbortSignal): Promise<string | null> {
        const [owner, repo] = repoKey.split("/");
        return await getLatestReleaseTag(owner, repo, this.log, signal);
    }

    private setUpdateState(key: string, state: PackageUpdateState): void {
        this.updateStates.set(key, state);
        this.applyUpdateState(key);
    }

    /** 检查更新结果：有新版本时在已安装版本右侧显示「→ 新版本」，箭头与新版本用主色 */
    private applyUpdateState(key: string): void {
        const el = this.rowUpdateEls.get(key);
        const state = this.updateStates.get(key);
        if (el === undefined || state === undefined) {
            return;
        }
        const button = this.rowCheckEls.get(key);
        button?.classList.toggle("jcip-local__check--outdated", state.kind === "outdated");
        if (state.kind === "outdated") {
            el.textContent = i18n.installedUpdateArrow.replace("{version}", state.latestTag);
            el.title = i18n.installedOutdated.replace("{version}", state.latestTag);
        } else {
            el.title = "";
        }
        el.classList.toggle("jcip-local__update--outdated", state.kind === "outdated");
        el.classList.toggle("jcip-local__update--error", state.kind === "failed");
        switch (state.kind) {
            case "latest":
                el.textContent = i18n.installedLatest;
                break;
            case "unknown":
                el.textContent = i18n.installedCheckUnknown.replace("{version}", state.latestTag);
                break;
            case "failed":
                el.textContent = i18n.installedCheckFailed;
                break;
            default:
                break;
        }
    }

    /** 回到「未检查」：中断或重新加载列表时清掉半成品状态 */
    private clearUpdateState(key: string): void {
        this.updateStates.delete(key);
        const el = this.rowUpdateEls.get(key);
        if (el === undefined) {
            return;
        }
        el.textContent = "";
        el.title = "";
        el.classList.remove("jcip-local__update--outdated", "jcip-local__update--error");
        this.rowCheckEls.get(key)?.classList.remove("jcip-local__check--outdated");
    }

    /**
     * 卡片点击
     *
     * 右下角图标按钮与仓库链接各有自己的行为，其余位置点开安装页签
     */
    private async onCardsClick(event: Event): Promise<void> {
        if (!(event.target instanceof Element)) {
            return;
        }
        const button = event.target.closest("button[data-action]");
        if (button instanceof HTMLButtonElement) {
            if (button.disabled) {
                return;
            }
            const pkg = this.packageOf(button);
            if (pkg === undefined) {
                return;
            }
            if (button.dataset.action === "check") {
                await this.checkOne(pkg);
            } else if (button.dataset.action === "uninstall") {
                await this.uninstallOne(pkg);
            }
            return;
        }
        // 仓库链接自行在新标签页打开
        if (event.target.closest("a") !== null) {
            return;
        }
        const card = event.target.closest(".jcip-local__card");
        if (!(card instanceof HTMLElement)) {
            return;
        }
        const pkg = this.packages.find((item) => rowKey(item) === card.dataset.key);
        if (pkg !== undefined) {
            this.openInstallPage(pkg);
        }
    }

    /** 按钮所在的卡片对应的包 */
    private packageOf(el: Element): InstalledPackage | undefined {
        const key = el.closest(".jcip-local__card")?.getAttribute("data-key") ?? "";
        return this.packages.find((item) => rowKey(item) === key);
    }

    /** 打开该包的安装页签：隐藏 URL 栏、回填已安装版本，并按该包当前的启用状态决定「安装后启用」 */
    private openInstallPage(pkg: InstalledPackage): void {
        // 插件看是否启用，主题与图标看是否为当前使用；挂件与模板没有该状态，沿用默认值
        const enableAfterInstall = pkg.type === "plugin"
            ? pkg.enabled
            : pkg.type === "theme" || pkg.type === "icon"
                ? pkg.current
                : undefined;
        this.openInstallTab({
            url: pkg.repoURL,
            repoKey: pkg.repoKey,
            installed: {
                kernelType: pkg.kernelType,
                name: pkg.name,
                displayName: pkg.displayName,
                version: pkg.version,
                ...(enableAfterInstall === undefined ? {} : { enableAfterInstall }),
            },
        });
    }

    private async uninstallOne(pkg: InstalledPackage): Promise<void> {
        if (await uninstallInstalledPackages([pkg], this.log)) {
            await this.reload();
        }
    }

    /** 类型页签：当前类型用实心按钮，其余用描边；数量为 0 时不显示标记 */
    private renderTabs(): void {
        const fragment = document.createDocumentFragment();
        this.tabEls.clear();
        for (const kernelType of KERNEL_PACKAGE_TYPES) {
            const tab = document.createElement("button");
            tab.type = "button";
            tab.className = "b3-button b3-button--outline";
            tab.dataset.type = "tab";
            tab.dataset.kernelType = kernelType;
            const label = document.createElement("span");
            label.textContent = kernelPackageTypeLabel(kernelType);
            const count = document.createElement("span");
            count.className = "jcip-local__tab-count";
            tab.append(label, count);
            this.tabEls.set(kernelType, { tab, count });
            fragment.append(tab);
        }
        this.tabsEl.replaceChildren(fragment);
        this.syncTabs();
    }

    private syncTabs(): void {
        for (const [kernelType, els] of this.tabEls) {
            const count = this.packages.filter((pkg) => pkg.kernelType === kernelType).length;
            els.count.textContent = String(count);
            els.count.classList.toggle("fn__none", count === 0);
            els.tab.classList.toggle("b3-button--outline", kernelType !== this.activeType);
        }
    }

    /** 只渲染当前类型的卡片，顺序与「本地集市包列表」一致：跟随思源集市「已下载」的排序配置 */
    private renderCards(): void {
        this.rowUpdateEls.clear();
        this.rowCheckEls.clear();
        const fragment = document.createDocumentFragment();
        const ofType = this.packages.filter((item) => item.kernelType === this.activeType);
        for (const pkg of sortInstalledPackages(this.activeType, ofType)) {
            fragment.append(this.renderCard(pkg));
        }
        this.cardsEl.replaceChildren(fragment);
    }

    /** 卡片图标；图标缺失或加载失败时显示思源的集市图标，尺寸一致故卡片高度不变 */
    private renderCardIcon(pkg: InstalledPackage): HTMLElement {
        const wrap = document.createElement("div");
        wrap.className = "jcip-local__card-icon";
        const placeholder = document.createElement("span");
        placeholder.className = "jcip-local__icon-fallback";
        // 必须交给 HTML 解析器建 SVG：`document.createElement("svg")` 得到的是未知元素，里面的 <use> 不会渲染
        placeholder.innerHTML = `<svg><use xlink:href="#${BAZAAR_ICON_ID}"></use></svg>`;
        if (pkg.iconURL === "") {
            wrap.append(placeholder);
            return wrap;
        }
        const img = document.createElement("img");
        img.src = pkg.iconURL;
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        img.addEventListener("error", () => {
            img.classList.add("fn__none");
            placeholder.classList.remove("fn__none");
        }, { once: true });
        img.addEventListener("load", () => {
            placeholder.classList.add("fn__none");
        }, { once: true });
        placeholder.classList.add("fn__none");
        wrap.append(img, placeholder);
        return wrap;
    }

    /** 卡片上的状态说明：只在有具体含义时才出现，用纯文本而不是胶囊 */
    private renderNotes(pkg: InstalledPackage, isOwn: boolean): string[] {
        const notes: string[] = [];
        if (isOwn) {
            notes.push(i18n.installedSelf);
        }
        if (pkg.invalidReason !== "") {
            notes.push(i18n.installedInvalid);
        }
        return notes;
    }

    private renderCard(pkg: InstalledPackage): HTMLElement {
        const key = rowKey(pkg);
        const isOwn = pkg.type === "plugin" && pkg.name === this.pluginName;
        const usable = isUsablePackage(pkg);
        const card = document.createElement("div");
        card.className = "jcip-local__card";
        card.dataset.key = key;
        card.title = i18n.installedOpenInstallPage;
        card.append(this.renderCardIcon(pkg));

        const main = document.createElement("div");
        main.className = "jcip-local__card-main";

        // 顶行：名称在左，已安装版本与更新提示贴在右上角
        const head = document.createElement("div");
        head.className = "jcip-local__head";
        const name = document.createElement("span");
        name.className = "jcip-local__name";
        name.textContent = pkg.displayName;
        if (pkg.displayName !== pkg.name) {
            name.title = pkg.name;
        }
        head.append(name);
        if (pkg.version !== "") {
            const version = document.createElement("span");
            version.className = "jcip-local__version";
            version.textContent = pkg.version;
            head.append(version);
        }
        const update = document.createElement("span");
        update.className = "jcip-local__update";
        head.append(update);
        this.rowUpdateEls.set(key, update);
        if (this.updateStates.has(key)) {
            this.applyUpdateState(key);
        }
        main.append(head);

        // 末行：来源在左，操作键在右（因此贴在卡片右下角），两者同行不另占一列去挤压名称
        const foot = document.createElement("div");
        foot.className = "jcip-local__foot";
        const meta = document.createElement("div");
        meta.className = "jcip-local__meta";
        if (pkg.repoKey !== "") {
            const repo = document.createElement("a");
            repo.className = "jcip-local__repo";
            repo.href = `https://github.com/${pkg.repoKey}`;
            repo.target = "_blank";
            repo.rel = "noopener noreferrer";
            repo.textContent = pkg.repoKey;
            meta.append(repo);
        } else {
            const el = document.createElement("span");
            el.className = "jcip-local__note";
            el.textContent = i18n.installedNoRepo;
            meta.append(el);
        }
        for (const note of this.renderNotes(pkg, isOwn)) {
            const el = document.createElement("span");
            el.className = "jcip-local__note";
            el.textContent = note;
            meta.append(el);
        }
        foot.append(meta);

        const actions = document.createElement("div");
        actions.className = "jcip-local__card-actions";
        if (usable) {
            const check = iconButton(REFRESH_ICON_ID, i18n.installedCheckButton, "check");
            this.rowCheckEls.set(key, check);
            actions.append(check);
        }
        // 插件自身不能卸载
        if (!isOwn) {
            actions.append(iconButton(TRASHCAN_ICON_ID, i18n.installedUninstallButton, "uninstall"));
        }
        foot.append(actions);
        main.append(foot);
        card.append(main);
        return card;
    }
}
