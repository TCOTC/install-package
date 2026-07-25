import { Menu } from "siyuan";
import { GITHUB_RELEASES_PER_PAGE, listReleasesPage, mergeInstallReleasePages } from "../github/github";
import { i18n } from "../infra/i18n";
import type { InstallReleaseRow } from "../github/github";
import type { Logger } from "./logger";
import type { InstallPanelData } from "./panel";
import type { InstallReleasesPayload } from "./repoParser";
import { upDownHint } from "./upDownHint";

export type InstallPanelVersionHooks = {
    /** 仅在用户在菜单中选定版本并写回 `data.version` 之后调用 */
    onPickedVersion: () => void;
};

/**
 * 版本选择控件：折叠展示、可搜索菜单、Release 分页加载、与 `data.version` 同步。
 */
export class InstallPanelVersion {
    private releaseRows: InstallReleaseRow[] = [];
    private latestReleaseTag: string | null = null;
    private releasesListOwner: string | null = null;
    private releasesListRepo: string | null = null;
    private releasesNextPage = 2;
    private releasesHasMore = false;
    private releasesLoadingMore = false;
    private releaseLoadMoreAbort: AbortController | null = null;
    /** 首页 Release 请求已发出、尚未收到 `onReleasesChanged`，需显示 loading 图标 */
    private releasesFirstPagePending = false;
    private versionMenu: Menu | null = null;
    private versionMenuListEl: HTMLElement | null = null;
    private versionMenuSearchEl: HTMLInputElement | null = null;
    private versionMenuScrollCleanup: (() => void) | null = null;

    constructor(
        private readonly data: InstallPanelData,
        private readonly versionEl: HTMLButtonElement,
        private readonly packageInfoMainEl: HTMLDivElement,
        private readonly log: Logger,
        private readonly hooks: InstallPanelVersionHooks,
    ) {
        this.versionEl.addEventListener("click", (e) => {
            e.stopPropagation();
            if (this.versionEl.disabled) {
                return;
            }
            this.toggleVersionMenu();
        });
        this.versionEl.addEventListener("keydown", (e) => {
            if (this.versionEl.disabled) {
                return;
            }
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                this.toggleVersionMenu();
            }
        });
    }

    destroy(): void {
        this.releaseLoadMoreAbort?.abort();
        this.releaseLoadMoreAbort = null;
        this.releasesLoadingMore = false;
        this.versionMenuScrollCleanup?.();
        this.versionMenuScrollCleanup = null;
        this.versionMenu?.close();
        this.versionMenu = null;
        this.versionMenuListEl = null;
        this.versionMenuSearchEl = null;
    }

    /** 仓库解析完成且可安装 */
    setRepoParseReady(ready: boolean): void {
        this.versionEl.disabled = !ready;
        this.syncRepoSummaryReleaseExtras();
    }

    /** 开始加载首页 Release */
    onReleasesFetchStart(): void {
        this.releasesFirstPagePending = true;
        this.releaseRows = [];
        this.latestReleaseTag = null;
        this.releasesListOwner = null;
        this.releasesListRepo = null;
        this.releasesHasMore = false;
        this.releasesNextPage = 2;
        this.renderVersionList();
        this.syncRepoSummaryReleaseExtras();
    }

    /** Release 列表更新 */
    onReleasesChanged(options: InstallReleasesPayload): void {
        const { releases, latestTag, preferredTag, meta } = options;

        this.releasesFirstPagePending = false;
        this.releaseLoadMoreAbort?.abort();
        this.releaseLoadMoreAbort = null;
        this.releasesLoadingMore = false;
        this.releaseRows = releases;
        this.latestReleaseTag = latestTag;
        this.releasesNextPage = 2;
        this.releasesListOwner = meta ? meta.owner : null;
        this.releasesListRepo = meta ? meta.repo : null;
        this.releasesHasMore = meta ? meta.initialPageFull : false;
        this.applyDefaultVersionIfEmpty(latestTag, preferredTag);
        this.syncVersionDisplay();
        this.renderVersionList();
    }

    syncVersionDisplay(): void {
        if (!this.data.version) {
            this.versionEl.textContent = "";
            this.syncRepoSummaryReleaseExtras();
            return;
        }
        let out = this.data.version;
        if (this.latestReleaseTag !== null && this.data.version === this.latestReleaseTag) {
            out += i18n.versionTagSuffixLatest;
        }
        const row = this.releaseRows.find((r) => r.tag === this.data.version);
        if (row?.prerelease) {
            out += i18n.versionTagSuffixPrerelease;
        }
        this.versionEl.textContent = out;
        this.syncRepoSummaryReleaseExtras();
    }

    /**
     * 外部已修改 `data.version`（例如面板清空）后，刷新折叠标签与已打开菜单中的选中态。
     */
    syncDisplayFromData(): void {
        this.syncVersionDisplay();
        this.renderVersionList();
    }

    /**
     * 在 `.jcip-repo-summary` 内同步：标题行后的选中版本链接（与下拉列表一致附带「（最新）」等后缀）、元信息区 Release 发布时间胶囊（首屏 Release 返回后才显示；「最新」不在胶囊内）。
     */
    private syncRepoSummaryReleaseExtras(): void {
        const root = this.packageInfoMainEl;
        if (!root.isConnected) {
            return;
        }
        const chip = root.querySelector("[data-jcip-release-published-chip]");
        const pickedWrap = root.querySelector("[data-jcip-picked-version-wrap]");
        const pickedLink = root.querySelector("[data-jcip-picked-version-link]");
        if (!(chip instanceof HTMLElement) || !(pickedWrap instanceof HTMLElement) || !(pickedLink instanceof HTMLAnchorElement)) {
            return;
        }

        const tag = this.data.version.trim();
        const owner = this.releasesListOwner;
        const repo = this.releasesListRepo;
        const releaseRow = tag ? this.releaseRows.find((r) => r.tag === tag) : undefined;
        const releaseUrl =
            owner && repo && tag
                ? `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/tag/${encodeURIComponent(tag)}`
                : null;

        if (tag && releaseUrl) {
            pickedWrap.classList.remove("fn__none");
            pickedWrap.setAttribute("aria-hidden", "false");
            pickedLink.href = releaseUrl;
            pickedLink.textContent = this.formatTagRowLabel(tag, releaseRow ?? { tag, publishedAt: "", prerelease: false });
            pickedLink.title = i18n.packageVersionSideOpenRelease;
        } else {
            pickedWrap.classList.add("fn__none");
            pickedWrap.setAttribute("aria-hidden", "true");
            pickedLink.removeAttribute("href");
            pickedLink.textContent = "";
            pickedLink.removeAttribute("title");
        }

        if (this.releasesFirstPagePending || !owner || !repo) {
            chip.classList.add("fn__none");
            chip.textContent = "";
            chip.removeAttribute("title");
            chip.classList.remove("jcip-repo-summary__chip--prerelease");
            return;
        }

        if (!tag || !releaseRow?.publishedAt) {
            chip.classList.add("fn__none");
            chip.textContent = "";
            chip.removeAttribute("title");
            chip.classList.remove("jcip-repo-summary__chip--prerelease");
            return;
        }

        const dateStr = formatReleasePublishedDateTime(releaseRow.publishedAt);
        chip.title = i18n.repoSummaryReleasePublishedTitle + dateStr;
        chip.classList.remove("fn__none");
        chip.classList.toggle("jcip-repo-summary__chip--prerelease", !!releaseRow.prerelease);

        const parts: string[] = [`<span class="jcip-repo-summary__chip-body">${escapeHtml(dateStr)}</span>`];
        if (releaseRow.prerelease) {
            parts.push(
                `<span class="jcip-repo-summary__chip-mark">${escapeHtml(i18n.packageVersionSidePrereleaseBadge)}</span>`,
            );
        }
        chip.innerHTML = parts.join("");
    }

    private formatTagRowLabel(tag: string, row: InstallReleaseRow): string {
        let out = tag;
        if (this.latestReleaseTag !== null && tag === this.latestReleaseTag) {
            out += i18n.versionTagSuffixLatest;
        }
        if (row.prerelease) {
            out += i18n.versionTagSuffixPrerelease;
        }
        return out;
    }

    /**
     * 写入默认版本：
     * - `preferredTag !== undefined`：URL 指定了 tag，强制选中（校验失败则为 `null`，回退 latest）
     * - 否则仅在 `data.version` 为空时用 `latestTag`
     */
    private applyDefaultVersionIfEmpty(
        latestTag: string | null,
        preferredTag?: string | null,
    ): void {
        if (preferredTag !== undefined) {
            this.data.version = preferredTag || latestTag || "";
            return;
        }
        if (this.data.version !== "") {
            return;
        }
        if (latestTag && typeof latestTag === "string") {
            this.data.version = latestTag;
        }
    }

    private toggleVersionMenu(): void {
        if (this.versionMenu) {
            this.versionMenu.close();
            return;
        }
        this.openVersionMenu();
    }

    private openVersionMenu(): void {
        const control = this.versionEl;
        const rect = control.getBoundingClientRect();
        const menu = new Menu("install-package-version", () => {
            this.releaseLoadMoreAbort?.abort();
            this.releaseLoadMoreAbort = null;
            this.releasesLoadingMore = false;
            this.versionMenuScrollCleanup?.();
            this.versionMenuScrollCleanup = null;
            this.versionMenu = null;
            this.versionMenuListEl = null;
            this.versionMenuSearchEl = null;
        });
        this.versionMenu = menu;
        menu.element.classList.add("b3-menu--list");
        menu.addItem({
            type: "empty",
            label: `<input class="b3-text-field fn__flex-shrink" type="text" placeholder="Git Tag" spellcheck="false" autocomplete="off"/>
<div class="fn__hr"></div>
<div class="b3-list fn__flex-1 b3-list--background"></div>`,
            bind: (wrap: HTMLElement) => {
                wrap.classList.add("fn__flex-column", "b3-menu__filter");
                const input = wrap.querySelector("input") as HTMLInputElement;
                const list = wrap.querySelector(".b3-list--background") as HTMLElement;
                this.versionMenuSearchEl = input;
                this.versionMenuListEl = list;
                input.value = "";
                this.renderVersionList();
                input.addEventListener("input", (ev) => {
                    ev.stopPropagation();
                    this.renderVersionList();
                });
                input.addEventListener("keydown", (e) => {
                    e.stopPropagation();
                    if (e.isComposing) {
                        return;
                    }
                    upDownHint(list, e);
                    if (e.key === "Enter") {
                        e.preventDefault();
                        this.commitVersionSearchInMenu(input, list, () => menu.close());
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        menu.close();
                    }
                });
                list.addEventListener("click", (e) => {
                    const row = (e.target as HTMLElement).closest(".b3-list-item[data-version]");
                    if (!row) {
                        return;
                    }
                    const v = row.getAttribute("data-version");
                    if (v === null) {
                        return;
                    }
                    this.applyVersion(v, () => menu.close());
                });
                const onListScroll = () => {
                    this.onVersionMenuListScroll(list);
                };
                list.addEventListener("scroll", onListScroll, { passive: true });
                this.versionMenuScrollCleanup = () => {
                    list.removeEventListener("scroll", onListScroll);
                };
                window.setTimeout(() => input.focus(), 0);
            },
        });
        menu.element.querySelector(".b3-menu__items")?.setAttribute("style", "overflow: initial");
        menu.open({ x: rect.left, y: rect.top + rect.height, h: rect.height, w: 0, isLeft: false });
    }

    private onVersionMenuListScroll(listEl: HTMLElement): void {
        if (!this.releasesHasMore || this.releasesLoadingMore) {
            return;
        }
        if (!this.releasesListOwner || !this.releasesListRepo) {
            return;
        }
        const thresholdPx = 48;
        if (listEl.scrollTop + listEl.clientHeight < listEl.scrollHeight - thresholdPx) {
            return;
        }
        void this.loadMoreReleasesIntoList(listEl);
    }

    private async loadMoreReleasesIntoList(listEl: HTMLElement): Promise<void> {
        if (!this.releasesListOwner || !this.releasesListRepo || !this.releasesHasMore || this.releasesLoadingMore) {
            return;
        }
        this.releasesLoadingMore = true;
        const ac = new AbortController();
        this.releaseLoadMoreAbort = ac;
        try {
            if (ac.signal.aborted) {
                return;
            }
            const result = await listReleasesPage(
                this.releasesListOwner,
                this.releasesListRepo,
                this.log,
                ac.signal,
                this.releasesNextPage,
                GITHUB_RELEASES_PER_PAGE,
            );
            if (ac.signal.aborted || result === null) {
                return;
            }
            this.releaseRows = mergeInstallReleasePages(this.releaseRows, result.rows);
            this.releasesNextPage += 1;
            this.releasesHasMore = result.pageFull;
            if (this.versionMenuListEl === listEl) {
                const savedScrollTop = listEl.scrollTop;
                this.renderVersionList();
                const clampScroll = () => {
                    const maxScroll = Math.max(0, listEl.scrollHeight - listEl.clientHeight);
                    listEl.scrollTop = Math.min(Math.max(0, savedScrollTop), maxScroll);
                };
                clampScroll();
                window.requestAnimationFrame(() => {
                    if (this.versionMenuListEl !== listEl) {
                        return;
                    }
                    clampScroll();
                });
            }
        } finally {
            if (this.releaseLoadMoreAbort === ac) {
                this.releaseLoadMoreAbort = null;
            }
            this.releasesLoadingMore = false;
        }
    }

    private renderVersionList(): void {
        const listEl = this.versionMenuListEl;
        if (!listEl) {
            return;
        }
        listEl.replaceChildren();
        if (this.releasesFirstPagePending) {
            // 使用思源原生 loading 图标
            listEl.innerHTML = '<img src="/stage/loading-pure.svg" style="margin: 0 auto; display: block; width: 64px; height: 64px;">';
            return;
        }
        const queryTrimmed = this.versionMenuSearchEl?.value.trim() ?? "";
        const queryLower = queryTrimmed.toLowerCase();

        const items: { value: string; label: string }[] = [];
        for (const r of this.releaseRows) {
            const label = this.formatTagRowLabel(r.tag, r);
            if (
                !queryLower ||
                r.tag.toLowerCase().includes(queryLower) ||
                label.toLowerCase().includes(queryLower)
            ) {
                items.push({ value: r.tag, label });
            }
        }

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const row = document.createElement("div");
            row.className =
                "b3-list-item b3-list-item--narrow" + (i === 0 ? " b3-list-item--focus" : "");
            row.setAttribute("data-version", item.value);
            const labelWrap = document.createElement("div");
            labelWrap.className = "fn__flex-1";
            if (queryTrimmed) {
                labelWrap.innerHTML = highlightSearchInLabel(item.label, queryTrimmed);
            } else {
                labelWrap.textContent = item.label;
            }
            row.append(labelWrap);
            if (item.value === this.data.version) {
                const checkedTpl = document.createElement("template");
                checkedTpl.innerHTML =
                    '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg>';
                row.append(checkedTpl.content.cloneNode(true));
            }
            listEl.append(row);
        }
    }

    private commitVersionSearchInMenu(
        input: HTMLInputElement,
        listEl: HTMLElement,
        closeMenu: () => void,
    ): void {
        const q = input.value.trim();
        const rows = [...listEl.querySelectorAll(".b3-list-item[data-version]")] as HTMLElement[];
        if (q) {
            const exact = rows.find((el) => (el.getAttribute("data-version") ?? "") === q);
            if (exact) {
                this.applyVersion(exact.getAttribute("data-version") ?? "", closeMenu);
                return;
            }
        }
        const focused = listEl.querySelector(".b3-list-item--focus[data-version]") as HTMLElement | null;
        if (focused) {
            this.applyVersion(focused.getAttribute("data-version") ?? "", closeMenu);
            return;
        }
        if (rows.length > 0) {
            this.applyVersion(rows[0].getAttribute("data-version") ?? "", closeMenu);
            return;
        }
        if (q) {
            this.applyVersion(q, closeMenu);
        }
    }

    private applyVersion(value: string, closeMenu?: () => void): void {
        this.data.version = value;
        this.syncVersionDisplay();
        closeMenu?.();
        this.hooks.onPickedVersion();
    }
}

/** 将 ISO 8601 发布时间格式化为本地日期时间（含秒、24 小时制）。 */
function formatReleasePublishedDateTime(iso: string): string {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) {
        return iso;
    }
    return d.toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 将命中子串包成 `<mark>`，行为对齐思源标签搜索列表；`query` 为空时返回整段转义文本。 */
function highlightSearchInLabel(label: string, query: string): string {
    const q = query.trim();
    if (!q) {
        return escapeHtml(label);
    }
    const lowerLabel = label.toLowerCase();
    const lowerQ = q.toLowerCase();
    const qLen = q.length;
    const parts: string[] = [];
    let i = 0;
    while (i < label.length) {
        const idx = lowerLabel.indexOf(lowerQ, i);
        if (idx === -1) {
            parts.push(escapeHtml(label.slice(i)));
            break;
        }
        parts.push(escapeHtml(label.slice(i, idx)));
        parts.push("<mark>" + escapeHtml(label.slice(idx, idx + qLen)) + "</mark>");
        i = idx + qLen;
    }
    return parts.join("");
}
