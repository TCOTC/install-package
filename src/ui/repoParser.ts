import { i18n } from "../infra/i18n";
import { escapeHtml } from "../infra/html";
import {
    fallbackLatestTagFromRows,
    getReleaseInfo,
    githubRawRootFileUrl,
    listReleasesPage,
    mergeInstallReleasePages,
    packageZipCreatedAt,
    parseOwnerRepo,
    type ParsedPackageInfo,
} from "../github/github";
import type { InstallReleaseRow } from "../github/github";
import { isSelfRepo } from "../install/selfPackage";
import type { Logger } from "../infra/logger";
import type { InstallPanelData } from "./panelData";
import { REPO_SUMMARY_ATTRS } from "./repoSummaryDom";
import { openImagePreview } from "./imagePreview";

/** 简介 / 日期缺省时的占位 */
const REPO_SUMMARY_DASH = "—";

/** 缩略图加载成功后才允许点击放大；`src/index.scss` 用同一个类名给出可点样式 */
const RAW_PREVIEW_READY_CLASS = "jcip-repo-summary__preview-frame--ready";

/**
 * 仓库默认分支根目录里的 icon.png / preview.png 缩略图
 *
 * 两个文件只有文件名与标题不同，模板集中在这里生成，避免两份交互属性各写一遍而失配。
 * 缩略图加载失败时 `wireRawPreviewImages` 换成 `REPO_SUMMARY_DASH` 并保持不可交互
 */
function renderRawPreviewHtml(info: ParsedPackageInfo, fileName: string, caption: string): string {
    const zoomLabel = escapeHtml(i18n.repoRootPreviewZoomIn.replace("{name}", caption));
    return `<div class="jcip-repo-summary__preview">
<span class="jcip__label">${escapeHtml(caption)}</span>
<div class="jcip-repo-summary__preview-frame" data-jcip-preview-frame data-jcip-preview-caption="${escapeHtml(caption)}" role="button" tabindex="-1" aria-disabled="true" aria-label="${zoomLabel}">
<img data-jcip-raw-img src="${escapeHtml(githubRawRootFileUrl(info.owner, info.repo, info.defaultBranch, fileName))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
<span class="fn__none" data-jcip-raw-missing>${REPO_SUMMARY_DASH}</span>
</div>
</div>`;
}

/** Release 列表与 `latestTag`（与 `RepoReleasesEvent` 中 `type: "data"` 的载荷一致） */
export type InstallReleasesPayload = {
    releases: InstallReleaseRow[];
    latestTag: string | null;
    /**
     * URL 中带了 `/releases/tag/...` 时才会出现该字段：
     * - 字符串：校验存在后的 tag，须强制选中
     * - `null`：URL 指定了 tag 但未找到，强制回退到 `latestTag`（或清空）
     * 省略时：保持「仅 version 为空才用 latest」的旧行为
     */
    preferredTag?: string | null;
    meta?: {
        owner: string;
        repo: string;
        /** 该页 API 原始条数达到 `per_page`，可能还有下一页 */
        initialPageFull: boolean;
        /** 目标仓库是否为插件自身仓库：自我安装需要按最低版本过滤 Release 列表 */
        selfRepo: boolean;
    };
};

type RepoInfoElState =
    | { kind: "tip" }
    | { kind: "parsing" }
    | { kind: "invalid" }
    | { kind: "resolved"; packageInfo: ParsedPackageInfo };

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
${renderRawPreviewHtml(info, "icon.png", i18n.repoRootPreviewIconCaption)}
${renderRawPreviewHtml(info, "preview.png", i18n.repoRootPreviewPreviewCaption)}
</div>`
            : "";
    return `<div class="jcip-repo-summary__body">
<div class="jcip-repo-summary__head">
${avatarBlock}
<div class="jcip-repo-summary__head-main">
<div class="jcip-repo-summary__title">
<a class="jcip-repo-summary__title-link" href="${ownerUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(info.owner)}</a><span aria-hidden="true">/</span><a class="jcip-repo-summary__title-link" href="${repoUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(info.repo)}</a><span class="jcip-repo-summary__picked fn__none" ${REPO_SUMMARY_ATTRS.pickedVersionWrap} aria-hidden="true"><a class="jcip-repo-summary__title-link" ${REPO_SUMMARY_ATTRS.pickedVersionLink} target="_blank" rel="noopener noreferrer"></a></span>
</div>
<div class="jcip-repo-summary__meta">
${licenseChip}
<span class="jcip-repo-summary__chip" title="${starsTitle}"><span aria-hidden="true">★</span>${escapeHtml(String(info.stars))}</span>
<span class="jcip-repo-summary__chip jcip-repo-summary__chip--release-time fn__none" ${REPO_SUMMARY_ATTRS.releasePublishedChip} title=""></span>
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

/**
 * 缩略图加载成功后接入放大预览（点击或回车 / 空格）
 *
 * 加载失败（仓库根目录没有该文件）时保持不可交互：既是空图，也不该弹出对话框
 */
function wireRawPreviewImages(root: HTMLElement): void {
    for (const img of root.querySelectorAll<HTMLImageElement>("img[data-jcip-raw-img]")) {
        const frame = img.closest<HTMLElement>("[data-jcip-preview-frame]");
        const miss = frame?.querySelector<HTMLElement>("[data-jcip-raw-missing]");
        if (!frame || !miss) {
            continue;
        }
        const markMissing = () => {
            img.classList.add("fn__none");
            miss.classList.remove("fn__none");
            frame.classList.remove(RAW_PREVIEW_READY_CLASS);
            frame.setAttribute("aria-disabled", "true");
            frame.tabIndex = -1;
        };
        const markReady = () => {
            miss.classList.add("fn__none");
            frame.classList.add(RAW_PREVIEW_READY_CLASS);
            frame.setAttribute("aria-disabled", "false");
            frame.tabIndex = 0;
        };
        // 命中浏览器缓存时 load / error 不会再触发，先按当前状态定一次
        if (img.complete) {
            if (img.naturalWidth > 0) {
                markReady();
            } else {
                markMissing();
            }
        } else {
            img.addEventListener("load", markReady, { once: true });
            img.addEventListener("error", markMissing, { once: true });
        }

        const openPreview = () => {
            if (img.naturalWidth === 0) {
                // 图片还没加载完（或已失败）时不打开：`markMissing` 与 `tabIndex` 已挡住大多数入口
                return;
            }
            openImagePreview(img.src, frame.getAttribute("data-jcip-preview-caption") ?? "");
        };
        frame.addEventListener("click", openPreview);
        frame.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") {
                return;
            }
            // 空格会滚动页面，须拦下
            event.preventDefault();
            openPreview();
        });
    }
}

export class RepoParser {
    private infoAbort?: AbortController;
    private lastParsed: { url: string; owner: string; repo: string } | null = null;
    /** 最近一次成功解析出的仓库信息（摘要块渲染用）；解析中 / 无效 / 未输入时为 null */
    private resolvedInfo: ParsedPackageInfo | null = null;
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
                    const { owner, repo, urlTag } = ownerRepo;
                    this.lastParsed = { url, owner, repo };
                    this.updateRepoInfoEl({ kind: "resolved", packageInfo: ownerRepo });
                    this.hooks.onRepoParseEvent?.({
                        type: "settled",
                        data: { owner, repo },
                    });
                    await this.loadReleases(owner, repo, signal, urlTag);
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

    /**
     * 最近一次成功解析出的仓库信息（描述、星标、许可证、主页等）
     *
     * 与摘要块展示的是同一份数据，因此「对比本地包信息」不需要为它再发一次请求；
     * 解析中、无效或解析失败时为 null
     */
    getResolvedInfo(): ParsedPackageInfo | null {
        return this.resolvedInfo;
    }

    private updateRepoInfoEl(state: RepoInfoElState): void {
        this.resolvedInfo = state.kind === "resolved" ? state.packageInfo : null;
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

    private async loadReleases(
        owner: string,
        repo: string,
        signal: AbortSignal,
        urlTag: string | null,
    ): Promise<void> {
        this.hooks.onRepoReleasesEvent?.({ type: "fetchStart" });
        // 拉正式 latest 以标记「（最新）」；无正式版时由列表回退。URL 带了 tag 时并行校验该 Release（含预览版）
        // 自身仓库的识别与 Release 请求并行：本地目录与元数据只需读取一次，命中缓存后不再有开销
        const [latestRelease, page1, urlTagRelease, selfRepo] = await Promise.all([
            getReleaseInfo(owner, repo, "", this.log, signal, { fallbackToNewestWhenNoLatest: false }),
            listReleasesPage(owner, repo, this.log, signal, 1),
            urlTag ? getReleaseInfo(owner, repo, urlTag, this.log, signal) : Promise.resolve(null),
            isSelfRepo(owner, repo, this.log),
        ]);
        if (signal.aborted) {
            return;
        }
        let latestTag = typeof latestRelease?.tag_name === "string" ? latestRelease.tag_name : null;

        let preferredTag: string | null | undefined;
        let preferredRow: InstallReleaseRow | null = null;
        if (urlTag) {
            if (urlTagRelease && typeof urlTagRelease.tag_name === "string") {
                preferredTag = urlTagRelease.tag_name;
                preferredRow = {
                    tag: urlTagRelease.tag_name,
                    publishedAt: typeof urlTagRelease.published_at === "string" ? urlTagRelease.published_at : "",
                    packageZipAt: packageZipCreatedAt(urlTagRelease.assets),
                    prerelease: urlTagRelease.prerelease === true,
                };
            } else {
                preferredTag = null;
                this.log.warn(`Release tag from URL not found: ${urlTag}`);
            }
        }

        if (page1 === null) {
            if (!latestTag) {
                latestTag = preferredRow ? preferredRow.tag : null;
            }
            this.hooks.onRepoReleasesEvent?.({
                type: "data",
                data: {
                    releases: preferredRow ? [preferredRow] : [],
                    latestTag,
                    ...(preferredTag !== undefined ? { preferredTag } : {}),
                    meta: { owner, repo, initialPageFull: false, selfRepo },
                },
            });
            return;
        }
        const releases = preferredRow
            ? mergeInstallReleasePages(page1.rows, [preferredRow])
            : page1.rows;
        // 无正式 latest（例如仅有预览版）时，自动选发布时间最新的版本；无任何版本则保持 null
        if (!latestTag) {
            latestTag = fallbackLatestTagFromRows(releases);
        }
        this.hooks.onRepoReleasesEvent?.({
            type: "data",
            data: {
                releases,
                latestTag,
                ...(preferredTag !== undefined ? { preferredTag } : {}),
                meta: {
                    owner,
                    repo,
                    initialPageFull: page1.pageFull,
                    selfRepo,
                },
            },
        });
    }
}
