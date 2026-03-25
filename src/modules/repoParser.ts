import { i18n } from "./i18n";
import { parseOwnerRepo } from "./github";

export class RepoParser {
    private previewAbort?: AbortController;
    private lastParsed: { input: string; owner: string; repo: string } | null = null;
    private pendingRefresh: Promise<void> = Promise.resolve();

    constructor(
        private readonly urlInput: HTMLInputElement,
        private readonly repoPreviewEl: HTMLDivElement
    ) {}

    refresh(): Promise<void> {
        this.lastParsed = null;
        this.previewAbort?.abort();
        this.previewAbort = new AbortController();
        const { signal } = this.previewAbort;
        const input = this.urlInput.value.trim();
        if (!input) {
            this.repoPreviewEl.textContent = i18n.repoPreviewTip;
            this.repoPreviewEl.style.color = "";
            this.pendingRefresh = Promise.resolve();
            return this.pendingRefresh;
        }
        this.repoPreviewEl.textContent = i18n.repoPreviewParsing;
        this.repoPreviewEl.style.color = "";
        const parsePreviewPromise = parseOwnerRepo(input, signal).then((parsed) => {
            if (signal.aborted || !this.repoPreviewEl.isConnected) {
                return;
            }
            if (parsed) {
                this.lastParsed = { input: input, owner: parsed.owner, repo: parsed.repo };
                this.repoPreviewEl.innerHTML = i18n.repoPreviewResolved.replace(
                    "{ownerRepo}",
                    `<b><a href="https://github.com/${parsed.owner}" target="_blank">${parsed.owner}</a></b> / <b><a href="https://github.com/${parsed.owner}/${parsed.repo}" target="_blank">${parsed.repo}</a></b>`
                );
                this.repoPreviewEl.style.color = "";
            } else {
                this.repoPreviewEl.textContent = i18n.repoPreviewInvalid;
                this.repoPreviewEl.style.color = "var(--b3-theme-error)";
            }
        });
        this.pendingRefresh = parsePreviewPromise.then(() => {});
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
            await this.refresh();
            if (this.lastParsed?.input === url) {
                return { owner: this.lastParsed.owner, repo: this.lastParsed.repo };
            }
        }
        return parseOwnerRepo(url);
    }
}
