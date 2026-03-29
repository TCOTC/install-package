import { i18n } from "./i18n";
import { parseOwnerRepo } from "./github";

export class RepoParser {
    private infoAbort?: AbortController;
    private lastParsed: { input: string; owner: string; repo: string } | null = null;
    private pendingRefresh: Promise<void> = Promise.resolve();

    /**
     * @param onRepoResolved - 解析出仓库时传入仓库名 `repo`；输入为空或解析失败时传入 `null`（用于恢复默认标题等）
     * @param onInstallReady - 仅当解析得到有效 owner/repo 时为 true；输入为空、解析中、失败时为 false
     */
    constructor(
        private readonly urlInput: HTMLInputElement,
        private readonly versionInput: HTMLInputElement,
        private readonly repoInfoEl: HTMLDivElement,
        private readonly log: (...args: unknown[]) => void,
        private readonly onRepoResolved?: (repoLabel: string | null) => void,
        private readonly onInstallReady?: (ready: boolean) => void,
    ) {}

    readonly blur = (): void => {
        this.urlInput.blur();
        this.versionInput.blur();
    };

    refresh(): Promise<void> {
        this.lastParsed = null;
        this.infoAbort?.abort();
        this.infoAbort = new AbortController();
        const { signal } = this.infoAbort;
        const input = this.urlInput.value.trim();
        if (!input) {
            this.repoInfoEl.textContent = i18n.repoInfoTip;
            this.repoInfoEl.style.color = "";
            this.onRepoResolved?.(null);
            this.onInstallReady?.(false);
            this.pendingRefresh = Promise.resolve();
            return this.pendingRefresh;
        }
        this.repoInfoEl.textContent = i18n.repoInfoParsing;
        this.repoInfoEl.style.color = "";
        this.onInstallReady?.(false);
        const parseInfoPromise = parseOwnerRepo(input, this.log, signal).then((parsed) => {
            if (signal.aborted || !this.repoInfoEl.isConnected) {
                return;
            }
            if (parsed) {
                this.lastParsed = { input: input, owner: parsed.owner, repo: parsed.repo };
                this.repoInfoEl.innerHTML = i18n.repoInfoResolved.replace(
                    "{ownerRepo}",
                    `<b><a href="https://github.com/${parsed.owner}" target="_blank">${parsed.owner}</a></b> / <b><a href="https://github.com/${parsed.owner}/${parsed.repo}" target="_blank">${parsed.repo}</a></b>`
                );
                this.repoInfoEl.style.color = "";
                this.onRepoResolved?.(parsed.repo);
                this.onInstallReady?.(true);
            } else {
                this.repoInfoEl.textContent = i18n.repoInfoInvalid;
                this.repoInfoEl.style.color = "var(--b3-theme-error)";
                this.onRepoResolved?.(null);
                this.onInstallReady?.(false);
            }
        });
        this.pendingRefresh = parseInfoPromise
            .catch(() => {
                if (!this.repoInfoEl.isConnected) {
                    return;
                }
                this.onInstallReady?.(false);
            })
            .then(() => {});
        return this.pendingRefresh;
    }

    async ownerRepoForUrl(url: string): Promise<{ owner: string; repo: string } | null> {
        url = url.trim();
        if (url === this.lastParsed?.input) {
            return { owner: this.lastParsed.owner, repo: this.lastParsed.repo };
        }
        const input = this.urlInput.value.trim();
        if (url === input) {
            await this.pendingRefresh;
            if (this.lastParsed?.input === url) {
                return { owner: this.lastParsed.owner, repo: this.lastParsed.repo };
            }
        }
        return parseOwnerRepo(url, this.log);
    }
}
