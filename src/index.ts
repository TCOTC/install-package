import { Dialog, Plugin, showMessage, fetchPost } from "siyuan";
import { findPluginAsset, getReleaseInfo, getRepositoryInfo } from "./modules/github";
import { downloadAndInstallPlugin } from "./modules/packageDetect";
import type { InstallFlowContext } from "./modules/installKernel";

// 为 Electron 环境扩展 Window 接口
declare global {
    interface Window {
        require?: (module: string) => any;
    }
}

export default class InstallPackage extends Plugin {
    /** 正在安装的仓库键（小写 owner/repo），用于避免同一仓库并发安装，不同仓库可并行 */
    private installInFlight = new Set<string>();

    onload() {
        this.addTopBar({
            // 图标来源 https://www.svgrepo.com/svg/355075/install
            icon: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path fill="none" stroke="currentColor" stroke-width="2" d="M19,13.5 L19,17.5 L12,22 L5,17.5 L5,13.5 M12,22 L12,13.5 M18.5,8.5 L12,4.5 L15.5,2 L22,6 L18.5,8.5 L18.5,8.5 L18.5,8.5 Z M5.5,8.5 L12,4.5 L8.5,2 L2,6 L5.5,8.5 L5.5,8.5 L5.5,8.5 Z M18.5,9 L12,13 L15.5,15.5 L22,11.5 L18.5,9 L18.5,9 L18.5,9 Z M5.5,9 L12,13 L8.5,15.5 L2,11.5 L5.5,9 L5.5,9 Z"/>
</svg>`,
            title: this.i18n.title,
            position: "right",
            callback: this.topBarHandler,
        });

        console.log(this.displayName, "plugin loaded");
    }

    onunload() {
        // console.log("InstallPackage unloaded");
    }

    uninstall() {
        // console.log("InstallPackage uninstalled");
    }

    private topBarHandler = () => {
        const isElectron = typeof window !== "undefined" && window.require;
        
        const dialog = new Dialog({
            title: this.i18n.title,
            width: isMobile() ? "92vw" : "520px",
            content: 
`<div class="b3-dialog__content">
    ${this.i18n.urlLabel}
    <div class="fn__hr"></div>
    <input data-type="url" class="b3-text-field fn__block" value="" placeholder="${this.i18n.urlPlaceholder}" spellcheck="false">
    <div class="fn__hr"></div>
    ${this.i18n.versionLabel}
    <div class="fn__hr"></div>
    <input data-type="version" class="b3-text-field fn__block" value="" placeholder="${this.i18n.versionPlaceholder}" spellcheck="false">
    <div class="fn__hr"></div>
    ${this.i18n.enableLabel}
    <div class="fn__hr"></div>
    <select data-type="enable" class="b3-select fn__block">
        <option value="enable">${this.i18n.enableOptionEnable}</option>
        <option value="disable">${this.i18n.enableOptionDisable}</option>
    </select>
    ${
        // 只在 Electron 环境下显示打开目录按钮
        !isElectron ? "" : `
        <div class="fn__hr"></div>
        <div class="fn__flex" style="gap: 8px;">
            <button data-type="open-plugins" class="b3-button b3-button--outline">${this.i18n.openPluginsDir}</button>
            <button data-type="open-petal" class="b3-button b3-button--outline">${this.i18n.openPetalDir}</button>
        </div>`
    }
</div>
<div class="b3-dialog__action">
    <button data-type="cancel" class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button data-type="confirm" class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        });
        const urlInput = dialog.element.querySelector("input[data-type='url']") as HTMLInputElement;
        const versionInput = dialog.element.querySelector("input[data-type='version']") as HTMLInputElement;
        const enableSelect = dialog.element.querySelector("select[data-type='enable']") as HTMLSelectElement;
        
        const getEnableValue = () => enableSelect.value === "enable";
        
        dialog.bindInput(urlInput, () => {
            this.installPackage(dialog, urlInput.value, versionInput.value, getEnableValue());
        });
        dialog.bindInput(versionInput, () => {
            this.installPackage(dialog, urlInput.value, versionInput.value, getEnableValue());
        });
        urlInput.select();

        const cancelButton = dialog.element.querySelector("button[data-type='cancel']") as HTMLButtonElement;
        cancelButton.addEventListener("click", () => {
            dialog.destroy();
        });
        const confirmButton = dialog.element.querySelector("button[data-type='confirm']") as HTMLButtonElement;
        confirmButton.addEventListener("click", () => {
            this.installPackage(dialog, urlInput.value, versionInput.value, getEnableValue());
        });
        
        const openPluginsButton = dialog.element.querySelector("button[data-type='open-plugins']") as HTMLButtonElement;
        openPluginsButton?.addEventListener("click", () => {
            this.openDirectory("data/plugins");
        });
        
        const openPetalButton = dialog.element.querySelector("button[data-type='open-petal']") as HTMLButtonElement;
        openPetalButton?.addEventListener("click", () => {
            this.openDirectory("data/storage/petal");
        });
    };

    private installPackage = async (dialog: Dialog, url: string, version: string, enable: boolean) => {
        url = url.trim();
        version = version.trim();

        let owner: string;
        let repo: string;

        // 尝试从 GitHub URL 提取 owner、repo
        const githubUrlMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)/i);
        const shortFormatMatch = url.match(/^([^\/\s]+)\/([^\/\s]+)$/);
        if (githubUrlMatch) {
            owner = githubUrlMatch[1];
            repo = githubUrlMatch[2];
            if (repo.toLowerCase().endsWith(".git")) {
                repo = repo.slice(0, -4);
            }
            console.log(`extract from GitHub URL: ${owner}/${repo}`);
        } else if (shortFormatMatch) {
            owner = shortFormatMatch[1];
            repo = shortFormatMatch[2];
            console.log(`extract from short format: ${owner}/${repo}`);
        } else {
            this.showMessage(this.i18n.invalidUrl, "error");
            return;
        }

        const repoLockKey = `${owner}/${repo}`.toLowerCase();
        if (this.installInFlight.has(repoLockKey)) {
            console.warn(repoLockKey + " is already in download queue");
            return;
        }
        this.installInFlight.add(repoLockKey);

        try {
            console.log("install package: url=" + url + ", version=" + version + ", enable=" + enable);
            // 获取仓库信息
            const repoInfo = await getRepositoryInfo(owner, repo);
            if (!repoInfo) {
                this.showMessage(this.i18n.repoInfoError, "error");
                return;
            }
            
            // 显示仓库信息
            console.log(`Repository: ${repoInfo.full_name}`);
            console.log(`Description: ${repoInfo.description || "No description"}`);
            console.log(`Stars: ${repoInfo.stargazers_count}`);
            console.log(`Last updated: ${new Date(repoInfo.updated_at).toLocaleDateString()}`);
            
            // 获取 Release 信息
            const releaseInfo = await getReleaseInfo(owner, repo, version);
            if (!releaseInfo) {
                const versionText = version || this.i18n.latest;
                this.showMessage(this.i18n.releaseInfoError.replace("{version}", versionText), "error");
                return;
            }
            
            console.log("Release Info:", releaseInfo);
            const publishedAt = releaseInfo.published_at 
                ? this.i18n.publishedOn.replace("{date}", new Date(releaseInfo.published_at).toLocaleDateString())
                : "";
            this.showMessage(this.i18n.foundRelease.replace("{tagName}", releaseInfo.tag_name).replace("{publishedAt}", publishedAt), "info");
            
            // 显示 Release 描述（如果有的话）
            if (releaseInfo.body && releaseInfo.body.trim()) {
                console.log(`Release description: ${releaseInfo.body.substring(0, 200)}${releaseInfo.body.length > 200 ? "..." : ""}`);
            }
            
            // 查找包文件
            const pluginAsset = findPluginAsset(releaseInfo.assets);
            if (!pluginAsset) {
                this.showMessage(this.i18n.packageZipNotFound, "error");
                return;
            }
            
            this.showMessage(this.i18n.downloading.replace("{fileName}", pluginAsset.name).replace("{fileSize}", this.formatFileSize(pluginAsset.size)), "info");
            
            // 使用 GitHub 下载 URL
            const downloadUrl = pluginAsset.browser_download_url;
            
            console.log("downloadUrl", downloadUrl);
            const { success, packageType } = await downloadAndInstallPlugin(
                downloadUrl,
                pluginAsset.name,
                enable,
                this.getInstallFlowContext()
            );
            
            if (success) {
                const autoEnabledText = enable && packageType === "plugin" ? this.i18n.autoEnabled : this.i18n.enableManually;
                console.log(this.i18n.downloadSuccess.replace("{autoEnabled}", autoEnabledText));
                dialog.destroy();
                return;
            }
            console.error("Failed to download or install package");
        } catch (error) {
            console.error("InstallPackage error:", error);
            this.showMessage(this.i18n.downloadFailed.replace("{error}", error.message), "error");
        } finally {
            this.installInFlight.delete(repoLockKey);
        }
    };

    private getInstallFlowContext(): InstallFlowContext {
        return {
            i18n: this.i18n as Record<string, string>,
            showMessage: (message, type = "info") => this.showMessage(message, type),
            reloadIcon: () => this.reloadIcon(),
        };
    }

    /**
     * 显示刷新对话框。v3.3.6 之后由内核推送到前端，不再需要手动重载 https://github.com/siyuan-note/siyuan/issues/16156
     */
//     private showReloadDialog(packageName: string, action: string): void {
//         const dialog = new Dialog({
//             title: "Plugin Status Change",
//             content: 
// `<div class="b3-dialog__content">
//     <div>Plugin ${packageName} has been ${action}d</div>
//     <div class="b3-label__text">To ensure the plugin works properly, it is recommended to refresh the interface. Refresh now?</div>
// </div>
// <div class="b3-dialog__action">
//     <button data-type="cancel" class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button>
//     <div class="fn__space"></div>
//     <button data-type="confirm" class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
// </div>`,
//             width: "400px"
//         });

//         dialog.element.querySelector('[data-type="cancel"]').addEventListener('click', () => {
//             dialog.destroy();
//         });

//         dialog.element.querySelector('[data-type="confirm"]').addEventListener('click', () => {
//             dialog.destroy();
//             // 使用 reloadUI API 刷新界面
//             fetchPost('/api/system/reloadUI');
//         });
//     }

    /**
     * 格式化文件大小
     */
    private formatFileSize(bytes: number): string {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    }

    /**
     * 重新加载图标
     */
    private async reloadIcon(): Promise<void> {
        try {
            console.log("Calling /api/ui/reloadIcon API...");
            
            const response = await fetch("/api/ui/reloadIcon", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                }
            });
            
            if (response.ok) {
                console.log("Icon reload API called successfully");
                this.showMessage(this.i18n.iconReloadSuccess, "info");
                
                // 显示确认对话框，询问是否重新加载界面
                setTimeout(() => {
                    this.showIconReloadDialog();
                }, 200);
            } else {
                console.error(`Failed to call reloadIcon API: ${response.status}`);
                this.showMessage(this.i18n.iconReloadFailed, "error");
            }
        } catch (error) {
            console.error("Failed to call reloadIcon API:", error);
            this.showMessage(this.i18n.iconReloadFailed, "error");
        }
    }

    /**
     * 显示图标包重新加载确认对话框
     */
    private showIconReloadDialog(): void {
        const dialog = new Dialog({
            title: this.i18n.iconPackageInstalled,
            content: 
`<div class="b3-dialog__content">
    <div>${this.i18n.iconPackageInstalled}</div>
    <div class="b3-label__text">${this.i18n.iconReloadDialogContent}</div>
</div>
<div class="b3-dialog__action">
    <button data-type="cancel" class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button>
    <div class="fn__space"></div>
    <button data-type="confirm" class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
            width: "400px"
        });

        dialog.element.querySelector('[data-type="cancel"]').addEventListener("click", () => {
            dialog.destroy();
        });

        dialog.element.querySelector('[data-type="confirm"]').addEventListener("click", () => {
            dialog.destroy();
            // 使用 reloadUI API 刷新界面
            console.log("User confirmed UI reload, calling /api/system/reloadUI API...");
            fetchPost("/api/system/reloadUI");
        });
    }

    /**
     * 显示消息提示
     */
    private showMessage(message: string, type: "info" | "error" = "info") {
        showMessage(this.displayName + ": " + message, type === "info" ? 3000 : 10000, type);
    }

    /**
     * 打开目录（仅在 Electron 环境下调用）
     */
    private openDirectory(path: string): void {
        try {
            console.log(`Opening directory: ${path}`);
            
            const { shell } = window.require("electron");
            const workspaceDir = window.siyuan?.config?.system?.workspaceDir || "";
            const fullPath = workspaceDir ? `${workspaceDir}/${path}` : path;
            
            console.log(`Opening directory in Electron: ${fullPath}`);
            shell.openPath(fullPath).then((error: string) => {
                if (error) {
                    console.error(`Failed to open directory: ${error}`);
                    this.showMessage(`无法打开目录：${error}`, "error");
                } else {
                    console.log(`Directory opened successfully: ${fullPath}`);
                }
            });
        } catch (error) {
            console.error(`Failed to open directory: ${path}`, error);
            this.showMessage(`打开目录失败：${error.message}`, "error");
        }
    }
}

function isMobile() {
    return !!window.siyuan.mobile;
}