import { i18n } from "../infra/i18n";
import { parseOwnerRepo } from "../github/github";
import type { InstallPanelData, Logger } from "../types";

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

export class RepoParser {
    private infoAbort?: AbortController;
    private lastParsed: { url: string; owner: string; repo: string } | null = null;
    private pendingRefresh: Promise<void> = Promise.resolve();

    /**
     * @param repoInfoEl - 仓库信息展示节点（`data-type="repo-info"`）
     * @param onRepoResolved - 解析出仓库时传入仓库名 `repo`；输入为空或解析失败时传入 `null`（用于恢复默认标题等）
     * @param onInstallReady - 仓库解析完成且可安装时为 `true`，否则为 `false`
     */
    constructor(
        private readonly data: InstallPanelData,
        private readonly log: Logger,
        private readonly repoInfoEl: HTMLDivElement,
        private readonly onRepoResolved?: (repoLabel: string | null) => void,
        private readonly onInstallReady?: (ready: boolean) => void,
    ) {}

    /**
     * @param debounceMs 大于 0 时先进入「解析中」再延迟请求（用于输入框）；默认 0 为立即请求
     */
    refresh(debounceMs = 0): Promise<void> {
        this.lastParsed = null;
        this.infoAbort?.abort();
        this.infoAbort = new AbortController();
        const { signal } = this.infoAbort;

        if (!this.data.url) {
            this.updateRepoInfoEl({ kind: "tip" });
            this.onRepoResolved?.(null);
            this.onInstallReady?.(false);
            this.pendingRefresh = Promise.resolve();
            return this.pendingRefresh;
        }
        this.updateRepoInfoEl({ kind: "parsing" });
        this.onInstallReady?.(false);

        this.pendingRefresh = (async () => {
            if (debounceMs > 0) {
                await waitDebounce(debounceMs, signal);
                if (signal.aborted) {
                    return;
                }
            }
            try {
                const ownerRepo = await parseOwnerRepo(this.data.url, this.log, signal);
                if (signal.aborted) {
                    return;
                }
                if (ownerRepo) {
                    this.lastParsed = { url: this.data.url, owner: ownerRepo.owner, repo: ownerRepo.repo };
                    this.updateRepoInfoEl({ kind: "resolved", owner: ownerRepo.owner, repo: ownerRepo.repo });
                    this.onRepoResolved?.(ownerRepo.repo);
                    this.onInstallReady?.(true);
                } else {
                    this.updateRepoInfoEl({ kind: "invalid" });
                    this.onRepoResolved?.(null);
                    this.onInstallReady?.(false);
                }
            } catch {
                if (!signal.aborted) {
                    // 请求被取消时不执行
                    this.onInstallReady?.(false);
                }
            }
        })();
        return this.pendingRefresh;
    }

    async getOwnerRepo(): Promise<{ owner: string; repo: string } | null> {
        await this.pendingRefresh;
        if (this.lastParsed?.url === this.data.url) {
            return { owner: this.lastParsed.owner, repo: this.lastParsed.repo };
        }
        await this.refresh();
        if (this.lastParsed?.url === this.data.url) {
            return { owner: this.lastParsed.owner, repo: this.lastParsed.repo };
        }
        return null;
    }

    /** 页签关闭或插件关闭时取消未完成的解析与防抖等待 */
    destroy(): void {
        this.infoAbort?.abort();
    }

    private updateRepoInfoEl(state: RepoInfoElState): void {
        const el = this.repoInfoEl;
        if (!el.isConnected) {
            return;
        }
        switch (state.kind) {
            case "tip":
                el.style.color = "";
                el.textContent = i18n.repoInfoTip;
                break;
            case "parsing":
                el.style.color = "";
                el.textContent = i18n.repoInfoParsing;
                break;
            case "invalid":
                el.style.color = "var(--b3-theme-error)";
                el.textContent = i18n.repoInfoInvalid;
                break;
            case "resolved":
                el.style.color = "";
                el.innerHTML = i18n.repoInfoResolved.replace(
                    "{ownerRepo}",
                    `<b><a href="https://github.com/${state.owner}" target="_blank">${state.owner}</a></b> / <b><a href="https://github.com/${state.owner}/${state.repo}" target="_blank">${state.repo}</a></b>`,
                );
                break;
        }
    }
}
