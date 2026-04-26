import { i18n } from "../infra/i18n";
import { getReleaseInfo, listReleasesPage, parseOwnerRepo } from "../github/github";
import type { InstallReleaseRow } from "../github/github";
import type { Logger } from "./logger";
import type { InstallPanelData } from "./panel";

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
    | { kind: "resolved"; owner: string; repo: string };

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

export class RepoParser {
    private infoAbort?: AbortController;
    private lastParsed: { url: string; owner: string; repo: string } | null = null;
    private pendingRefresh: Promise<void> = Promise.resolve();
    /** 当前 `pendingRefresh` 所对应的非空 URL；完成后或与新一轮刷新顶替时清除 */
    private pendingRefreshUrl: string | null = null;
    constructor(
        private readonly data: InstallPanelData,
        private readonly log: Logger,
        private readonly repoInfoEl: HTMLDivElement,
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
            this.hooks.onRepoReleasesEvent?.({ type: "data", data: { releases: [], latestTag: null } });
            this.hooks.onRepoParseEvent?.({ type: "settled", data: null });
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
                    this.updateRepoInfoEl({ kind: "resolved", owner, repo });
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
        if (!this.repoInfoEl.isConnected) {
            return;
        }
        switch (state.kind) {
            case "tip":
                this.repoInfoEl.style.color = "";
                this.repoInfoEl.textContent = i18n.repoInfoTip;
                break;
            case "parsing":
                this.repoInfoEl.style.color = "";
                this.repoInfoEl.textContent = i18n.repoInfoParsing;
                break;
            case "invalid":
                this.repoInfoEl.style.color = "var(--b3-theme-error)";
                this.repoInfoEl.textContent = i18n.repoInfoInvalid;
                break;
            case "resolved":
                this.repoInfoEl.style.color = "";
                this.repoInfoEl.innerHTML = i18n.repoInfoResolved.replace(
                    "{ownerRepo}",
                    `<b><a href="https://github.com/${state.owner}" target="_blank">${state.owner}</a></b> / <b><a href="https://github.com/${state.owner}/${state.repo}" target="_blank">${state.repo}</a></b>`,
                );
                break;
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
            this.hooks.onRepoReleasesEvent?.({ type: "data", data: { releases: [], latestTag } });
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
