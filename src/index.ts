import { Dialog, Plugin, showMessage, fetchPost } from "siyuan";
import { findPluginAsset, getReleaseInfo, getRepositoryInfo, parseOwnerRepo } from "./modules/github";
import { downloadAndInstallPlugin } from "./modules/packageDetect";

declare global {
    interface Window {
        require?(moduleName: "electron"): typeof import("electron");
        require?(moduleName: string): any;
    }
}

const electron: typeof import("electron") | undefined = (() => {
    try {
        return typeof window !== "undefined" ? window.require?.("electron") : undefined;
    } catch {
        return undefined;
    }
})();

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
        !electron ? "" : `
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

        const parsed = await parseOwnerRepo(url);
        if (!parsed) {
            this.message(this.i18n.invalidUrl, true);
            return;
        }
        const { owner, repo } = parsed;

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
                this.message(this.i18n.repoInfoError, true);
                return;
            }
            
            // 显示仓库信息
            console.log(`Repository: ${repoInfo.full_name}`);
            console.log(`Description: ${repoInfo.description || ""}`);
            console.log(`Stars: ${repoInfo.stargazers_count}`);
            console.log(`Last updated: ${new Date(repoInfo.updated_at).toLocaleDateString()}`);
            
            // 获取 Release 信息
            const releaseInfo = await getReleaseInfo(owner, repo, version);
            if (!releaseInfo) {
                const versionText = version || "latest";
                this.message(this.i18n.releaseInfoError.replace("{version}", versionText), true);
                return;
            }
            
            this.message(
                this.i18n.foundRelease
                .replace("{tagName}", releaseInfo.tag_name)
                .replace("{publishedAt}", (
                    releaseInfo.published_at ? this.i18n.publishedOn.replace("{date}", new Date(releaseInfo.published_at).toLocaleDateString()) : ""
                ))
            );
            
            // 显示 Release 描述（如果有的话）
            if (releaseInfo.body && releaseInfo.body.trim()) {
                console.log(`Release description: ${releaseInfo.body.substring(0, 200)}${releaseInfo.body.length > 200 ? "..." : ""}`);
            }
            
            // 查找包文件
            const pluginAsset = findPluginAsset(releaseInfo.assets);
            if (!pluginAsset) {
                this.message(this.i18n.packageZipNotFound, true);
                return;
            }
            
            this.message(this.i18n.downloading.replace("{fileName}", pluginAsset.name).replace("{fileSize}", this.formatFileSize(pluginAsset.size)));
            
            // 使用 GitHub 下载 URL
            const downloadUrl = pluginAsset.browser_download_url;
            
            console.log("downloadUrl", downloadUrl);
            const result = await downloadAndInstallPlugin(
                downloadUrl,
                pluginAsset.name,
                enable,
                this.i18n
            );

            if (result.infos) {
                for (const text of result.infos) {
                    this.message(text, false);
                }
            }
            if (result.enableWarnings) {
                for (const text of result.enableWarnings) {
                    this.message(text, true);
                }
            }

            if (!result.success) {
                if (result.error) {
                    this.message(result.error, true);
                } else {
                    this.message(this.i18n.packageInstallFailed, true);
                }
                console.error("Failed to download or install package");
                return;
            }

            let autoEnabledText = "";
            if (result.packageType === "plugin") {
                autoEnabledText = enable
                    ? this.i18n.packageInstalledSuccessAuto
                    : this.i18n.packageInstalledSuccessManual;
            } else if (result.packageType === "widget" || result.packageType === "template") {
                // 挂件和模板没有「启用」的概念
            } else if (result.packageType === "theme" || result.packageType === "icon") {
                autoEnabledText = this.i18n.packageInstalledSuccessManual;
            }
            this.message(
                this.i18n.packageInstalledSuccess
                    .replace("{packageType}", result.packageType ?? "")
                    .replace("{packageName}", result.packageName ?? "")
                    .replace("{autoEnabled}", autoEnabledText),
                false
            );

            if (result.shouldReloadIcon) {
                await this.reloadIcon();
            }

            const autoEnabledTextForLog =
                enable && result.packageType === "plugin" ? this.i18n.autoEnabled : this.i18n.enableManually;
            console.log(this.i18n.downloadSuccess.replace("{autoEnabled}", autoEnabledTextForLog));
            dialog.destroy();
            return;
        } catch (error) {
            console.error("InstallPackage error:", error);
            this.message(
                this.i18n.downloadFailed.replace(
                    "{error}",
                    error instanceof Error ? error.message : String(error)
                ),
                true
            );
        } finally {
            this.installInFlight.delete(repoLockKey);
        }
    };

    private message(text: string, isError?: boolean): void {
        const type = isError ? "error" : "info";
        showMessage(this.displayName + ": " + text, isError ? 10000 : 3000, type);
    }

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
                this.message(this.i18n.iconReloadSuccess);
                
                // 显示确认对话框，询问是否重新加载界面
                setTimeout(() => {
                    this.showIconReloadDialog();
                }, 200);
            } else {
                console.error(`Failed to call reloadIcon API: ${response.status}`);
                this.message(this.i18n.iconReloadFailed, true);
            }
        } catch (error) {
            console.error("Failed to call reloadIcon API:", error);
            this.message(this.i18n.iconReloadFailed, true);
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
     * 打开目录（仅在 Electron 环境下调用）
     */
    private async openDirectory(relPath: string): Promise<void> {
        try {
            console.log(`Opening directory: ${relPath}`);

            if (!electron) {
                this.message(this.i18n.openDirectoryFailed + this.i18n.openDirectoryNoElectron, true);
                return;
            }

            const workspaceDir = (window.siyuan?.config?.system?.workspaceDir ?? "").trim();
            if (!workspaceDir) {
                this.message(this.i18n.openDirectoryFailed + this.i18n.openDirectoryNoWorkspace, true);
                return;
            }

            const fullPath = `${workspaceDir}/${relPath}`;

            if (electron.ipcRenderer) {
                // 优先走思源主进程 ipc，避免渲染进程使用 shell.openPath 时资源管理器在后台打开。
                electron.ipcRenderer.send("siyuan-cmd", {
                    cmd: "openPath",
                    filePath: fullPath,
                });
                return;
            }

            const openErr = await electron.shell.openPath(fullPath);
            if (openErr) {
                throw new Error(openErr);
            }
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.message(this.i18n.openDirectoryFailed + detail, true);
        }
    }
}

function isMobile() {
    return !!window.siyuan.mobile;
}