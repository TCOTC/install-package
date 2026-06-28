import { i18n } from "../infra/i18n";
import {
    getReleaseInfo,
    githubRawRootFileUrl,
    listReleasesPage,
    parseOwnerRepo,
    type ParsedPackageInfo,
} from "../github/github";
import type { InstallReleaseRow } from "../github/github";
import type { Logger } from "./logger";
import type { InstallPanelData } from "./panel";

/** 简介 / 日期缺省时的占位 */
const REPO_SUMMARY_DASH = "—";

/** Release 列表与 `latestTag`（与 `RepoReleasesEvent` 中 `type: "data"` 的载荷一致） */
export type InstallReleasesPayload = {
    releases: InstallReleaseRow[];
    latestTag: string | null;
    meta?: {
        owner: string;
        repo: string;
        /** 该页 API 原始条数达到 `per_page`，可能还有下一页 */
        initialPageFull: boolean;
    };
};

type RepoInfoElState =
    | { kind: "tip" }
    | { kind: "parsing" }
    | { kind: "invalid" }
    | { kind: "resolved"; packageInfo: ParsedPackageInfo };

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderResolvedRepoSummaryHtml(info: ParsedPackageInfo): string {
    const ownerUrl = `https://github.com/${encodeURIComponent(info.owner)}`;
    const repoUrl = `${ownerUrl}/${encodeURIComponent(info.repo)}`;
    const starsTitle = escapeHtml(i18n.repoSummaryStarsTitle.replace("{count}", String(info.stars)));
    const licenseChip = info.licenseDisplay
        ? `<span class="jcip-repo-summary__chip" translate="no" title="${escapeHtml(
              i18n.repoSummaryLicenseTitle + info.licenseDisplay,
          )}">${escapeHtml(info.licenseDisplay)}</span>`
        : "";
    const avatarBlock = info.ownerAvatarUrl
        ? `<img class="jcip-repo-summary__avatar" src="${escapeHtml(info.ownerAvatarUrl)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
        : "";
    const homepageChip = info.homepageUrl
        ? `<a class="jcip-repo-summary__chip jcip-repo-summary__chip--link" href="${escapeHtml(info.homepageUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(i18n.repoSummaryHomepageLabel)}</a>`
        : "";
    const descHas = info.description.trim().length > 0;
    const descBody = descHas ? escapeHtml(info.description) : escapeHtml(REPO_SUMMARY_DASH);
    const descClass = descHas ? "jcip-repo-summary__desc" : "jcip-repo-summary__desc jcip-repo-summary__desc--muted";
    const previewsBlock =
        info.defaultBranch.length > 0
            ? `<div class="jcip-repo-summary__previews" aria-label="${escapeHtml(i18n.repoRootPreviewGroupAria)}">
<div class="jcip-repo-summary__preview">
<span class="jcip__label">${escapeHtml(i18n.repoRootPreviewIconCaption)}</span>
<div data-jcip-preview-frame>
<img data-jcip-raw-img src="${escapeHtml(githubRawRootFileUrl(info.owner, info.repo, info.defaultBranch, "icon.png"))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
<span class="fn__none" data-jcip-raw-missing>${REPO_SUMMARY_DASH}</span>
</div>
</div>
<div class="jcip-repo-summary__preview">
<span class="jcip__label">${escapeHtml(i18n.repoRootPreviewPreviewCaption)}</span>
<div data-jcip-preview-frame>
<img data-jcip-raw-img src="${escapeHtml(githubRawRootFileUrl(info.owner, info.repo, info.defaultBranch, "preview.png"))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
<span class="fn__none" data-jcip-raw-missing>${REPO_SUMMARY_DASH}</span>
</div>
</div>
</div>`
            : "";
    return `<div class="jcip-repo-summary__body">
<div class="jcip-repo-summary__head">
${avatarBlock}
<div class="jcip-repo-summary__head-main">
<div class="jcip-repo-summary__title">
<a class="jcip-repo-summary__title-link" href="${ownerUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(info.owner)}</a><span aria-hidden="true">/</span><a class="jcip-repo-summary__title-link" href="${repoUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(info.repo)}</a><span class="jcip-repo-summary__picked fn__none" data-jcip-picked-version-wrap aria-hidden="true"><a class="jcip-repo-summary__title-link" data-jcip-picked-version-link target="_blank" rel="noopener noreferrer"></a></span>
</div>
<div class="jcip-repo-summary__meta">
${licenseChip}
<span class="jcip-repo-summary__chip" title="${starsTitle}"><span aria-hidden="true">★</span>${escapeHtml(String(info.stars))}</span>
<span class="jcip-repo-summary__chip jcip-repo-summary__chip--release-time fn__none" data-jcip-release-published-chip title=""></span>
${homepageChip}
</div>
</div>
</div>
<p class="${descClass}">${descBody}</p>
</div>
${previewsBlock}`;
}

/**
 * 防抖等待；`signal` abort 时清除定时器并立即结束，供新一轮 `refresh` 顶替时结束 `pendingRefresh`。
 */
function waitDebounce(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const onAbort = () => {
            clearTimeout(id);
            resolve();
        };
        const id = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * URL 解析状态。
 *
 * - `parsing`：仍在等待 `parseOwnerRepo`（含防抖）。
 * - `settled`：本轮已结束；`data === null` 为空 URL / 无效，非 null 时可安装。
 */
export type RepoParseEvent =
    | { type: "parsing" }
    | { type: "settled"; data: { owner: string; repo: string } | null };

/**
 * Release 相关通知：`fetchStart` 后必有后续 `data`（除非请求被取消）。
 */
export type RepoReleasesEvent =
    | { type: "fetchStart" }
    | { type: "data"; data: InstallReleasesPayload};

/**
 * `RepoParser` 对外的唯一入口：面板实现各钩子即可串起数据流。
 */
export type RepoParserHooks = {
    /**
     * 解析状态更新；消费者可按固定顺序处理标题、版本键、`repoParseReady`。
     */
    onRepoParseEvent?: (event: RepoParseEvent) => void;
    /**
     * Release：即将拉取首页，或列表 / `latestTag` 更新（解析开始 / 失败 / 首页返回等与原先 `onReleasesChange` 一致）。
     */
    onRepoReleasesEvent?: (event: RepoReleasesEvent) => void;
};

function wireRawPreviewImages(root: HTMLElement): void {
    for (const img of root.querySelectorAll<HTMLImageElement>("img[data-jcip-raw-img]")) {
        const frame = img.closest("[data-jcip-preview-frame]");
        const miss = frame?.querySelector("[data-jcip-raw-missing]");
        if (!(miss instanceof HTMLElement)) {
            continue;
        }
        img.addEventListener(
            "error",
            () => {
                img.classList.add("fn__none");
                miss.classList.remove("fn__none");
            },
            { once: true },
        );
        img.addEventListener(
            "load",
            () => {
                miss.classList.add("fn__none");
            },
            { once: true },
        );
    }
}

export class RepoParser {
    private infoAbort?: AbortController;
    private lastParsed: { url: string; owner: string; repo: string } | null = null;
    private pendingRefresh: Promise<void> = Promise.resolve();
    /** 当前 `pendingRefresh` 所对应的非空 URL；完成后或与新一轮刷新顶替时清除 */
    private pendingRefreshUrl: string | null = null;
    constructor(
        private readonly data: InstallPanelData,
        private readonly log: Logger,
        private readonly repoInfoMainEl: HTMLDivElement,
        private readonly repoInfoPlaceholderEl: HTMLParagraphElement,
        private readonly hooks: RepoParserHooks,
    ) {}

    destroy(): void {
        this.infoAbort?.abort();
    }

    /**
     * 刷新解析状态。若 `url` 与正在进行的刷新相同，返回同一个 `Promise`。
     * 否则取消上一次正在进行的解析请求，并开始一次新的解析请求。
     *
     * @param debounceMs 大于 0 时先进入「解析中」再延迟请求（用于输入框）；默认 0 为立即请求
     */
    refresh(debounceMs = 0): Promise<void> {
        const url = this.data.url;
        if (url && this.pendingRefreshUrl === url) {
            return this.pendingRefresh;
        }
        this.lastParsed = null;
        this.infoAbort?.abort();
        this.infoAbort = new AbortController();
        const { signal } = this.infoAbort;

        if (!url) {
            this.pendingRefreshUrl = null;
            this.updateRepoInfoEl({ kind: "tip" });
            // 须先 settled 再通知 Release 清空，否则 uiStore 仍为 ready 时会同步调用 getOwnerRepo → refresh 死循环（重现操作：全选剪切 URL 输入框内容）
            this.hooks.onRepoParseEvent?.({ type: "settled", data: null });
            this.hooks.onRepoReleasesEvent?.({ type: "data", data: { releases: [], latestTag: null } });
            this.pendingRefresh = Promise.resolve();
            return this.pendingRefresh;
        }
        this.pendingRefreshUrl = url;
        this.updateRepoInfoEl({ kind: "parsing" });
        this.hooks.onRepoParseEvent?.({ type: "parsing" });
        this.hooks.onRepoReleasesEvent?.({ type: "data", data: { releases: [], latestTag: null } });

        this.pendingRefresh = (async () => {
            if (debounceMs > 0) {
                await waitDebounce(debounceMs, signal);
                if (signal.aborted) {
                    return;
                }
            }
            try {
                const ownerRepo = await parseOwnerRepo(url, this.log, signal);
                if (signal.aborted) {
                    return;
                }
                if (ownerRepo) {
                    const { owner, repo } = ownerRepo;
                    this.lastParsed = { url, owner, repo };
                    this.updateRepoInfoEl({ kind: "resolved", packageInfo: ownerRepo });
                    this.hooks.onRepoParseEvent?.({
                        type: "settled",
                        data: { owner, repo },
                    });
                    await this.loadReleases(owner, repo, signal);
                } else {
                    throw new Error("Invalid repository URL");
                }
            } catch {
                if (!signal.aborted) {
                    this.updateRepoInfoEl({ kind: "invalid" });
                    this.hooks.onRepoParseEvent?.({ type: "settled", data: null });
                    this.hooks.onRepoReleasesEvent?.({ type: "data", data: { releases: [], latestTag: null } });
                }
            } finally {
                if (!signal.aborted) {
                    this.pendingRefreshUrl = null;
                }
            }
        })();
        return this.pendingRefresh;
    }

    async getOwnerRepo(): Promise<{ owner: string; repo: string } | null> {
        if (!this.lastParsed) {
            await this.refresh();
        }
        if (!this.lastParsed) {
            return null;
        }
        return { owner: this.lastParsed.owner, repo: this.lastParsed.repo };
    }

    private updateRepoInfoEl(state: RepoInfoElState): void {
        if (!this.repoInfoMainEl.isConnected) {
            return;
        }
        const ph = this.repoInfoPlaceholderEl;
        switch (state.kind) {
            case "tip": {
                this.repoInfoMainEl.style.color = "";
                this.repoInfoMainEl.innerHTML = "";
                this.repoInfoMainEl.classList.add("fn__none");
                ph.style.color = "";
                ph.textContent = i18n.repoInfoTip;
                ph.classList.remove("fn__none");
                break;
            }
            case "parsing": {
                this.repoInfoMainEl.style.color = "";
                this.repoInfoMainEl.innerHTML = "";
                this.repoInfoMainEl.classList.add("fn__none");
                ph.style.color = "";
                ph.textContent = i18n.repoInfoParsing;
                ph.classList.remove("fn__none");
                break;
            }
            case "invalid": {
                this.repoInfoMainEl.style.color = "";
                this.repoInfoMainEl.innerHTML = "";
                this.repoInfoMainEl.classList.add("fn__none");
                ph.style.color = "var(--b3-theme-error)";
                ph.textContent = i18n.repoInfoInvalid;
                ph.classList.remove("fn__none");
                break;
            }
            case "resolved": {
                this.repoInfoMainEl.style.color = "";
                ph.style.color = "";
                ph.classList.add("fn__none");
                this.repoInfoMainEl.classList.remove("fn__none");
                this.repoInfoMainEl.innerHTML = renderResolvedRepoSummaryHtml(state.packageInfo);
                wireRawPreviewImages(this.repoInfoMainEl);
                break;
            }
        }
    }

    private async loadReleases(owner: string, repo: string, signal: AbortSignal): Promise<void> {
        this.hooks.onRepoReleasesEvent?.({ type: "fetchStart" });
        const [latestRelease, page1] = await Promise.all([
            // TODO 如果此时 version 存在的话要请求对应 version 的 release，否则才请求 latest
            getReleaseInfo(owner, repo, "", this.log, signal), // latest
            listReleasesPage(owner, repo, this.log, signal, 1),
        ]);
        if (signal.aborted) {
            return;
        }
        const latestTag = typeof latestRelease?.tag_name === "string" ? latestRelease.tag_name : null;
        if (page1 === null) {
            this.hooks.onRepoReleasesEvent?.({
                type: "data",
                data: {
                    releases: [],
                    latestTag,
                    meta: { owner, repo, initialPageFull: false },
                },
            });
            return;
        }
        this.hooks.onRepoReleasesEvent?.({
            type: "data",
            data: {
                releases: page1.rows,
                latestTag,
                meta: {
                    owner,
                    repo,
                    initialPageFull: page1.pageFull,
                },
            },
        });
    }
}
