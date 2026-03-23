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
    onload() {
        console.log("InstallPackage loaded");

        this.addTopBar({
            icon: "iconInstallPackagePlugin",
            title: this.i18n.title,
            position: "right",
            callback: this.topBarHandler,
        });

        this.addIcons(
`<symbol id="iconInstallPackagePlugin" viewBox="0 0 32 32">
    <path d="M15.996 23.275q-0.317 0-0.59-0.104t-0.53-0.362l-7.163-7.162q-0.482-0.491-0.457-1.145t0.478-1.136q0.495-0.482 1.16-0.489t1.148 0.474l4.353 4.384v-15.545q0-0.682 0.463-1.144t1.149-0.462q0.684 0 1.142 0.462t0.457 1.144v15.545l4.384-4.384q0.476-0.482 1.129-0.457t1.148 0.506q0.453 0.482 0.462 1.14t-0.474 1.14l-7.13 7.13q-0.257 0.258-0.534 0.362t-0.594 0.104zM3.795 31.417q-1.301 0-2.257-0.956t-0.956-2.257v-4.914q0-0.682 0.463-1.144t1.148-0.462 1.143 0.462 0.457 1.144v4.914h24.409v-4.914q0-0.682 0.463-1.144t1.148-0.462 1.143 0.462 0.457 1.144v4.914q0 1.301-0.956 2.257t-2.257 0.956h-24.409z"></path>
</symbol>`
        );
    }

    onLayoutReady() {
        // console.log("InstallPackage onLayoutReady");
    }

    onunload() {
        // console.log("InstallPackage unloaded");
    }

    uninstall() {
        // console.log("InstallPackage uninstalled");
    }

    private topBarHandler = () => {
        // 判断是否在 Electron 环境中
        const isElectron = typeof window !== 'undefined' && window.require;
        
        // 根据环境生成按钮 HTML
        const openDirButtons = isElectron ? `
    <div class="fn__hr"></div>
    <div class="fn__flex" style="gap: 8px;">
        <button data-type="open-plugins" class="b3-button b3-button--outline">${this.i18n.openPluginsDir}</button>
        <button data-type="open-petal" class="b3-button b3-button--outline">${this.i18n.openPetalDir}</button>
    </div>` : '';
        
        const dialog = new Dialog({
            title: this.i18n.dialogTitle,
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
    ${openDirButtons}
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
            this.installPackage(urlInput.value, versionInput.value, getEnableValue());
        });
        dialog.bindInput(versionInput, () => {
            this.installPackage(urlInput.value, versionInput.value, getEnableValue());
        });
        urlInput.select();

        const cancelButton = dialog.element.querySelector("button[data-type='cancel']") as HTMLButtonElement;
        cancelButton.addEventListener("click", () => {
            dialog.destroy();
        });
        const confirmButton = dialog.element.querySelector("button[data-type='confirm']") as HTMLButtonElement;
        confirmButton.addEventListener("click", () => {
            this.installPackage(urlInput.value, versionInput.value, getEnableValue());
            dialog.destroy();
        });
        
        // 只在 Electron 环境下添加打开目录按钮的事件监听器
        if (isElectron) {
            const openPluginsButton = dialog.element.querySelector("button[data-type='open-plugins']") as HTMLButtonElement;
            openPluginsButton.addEventListener("click", () => {
                this.openDirectory("data/plugins");
            });
            
            const openPetalButton = dialog.element.querySelector("button[data-type='open-petal']") as HTMLButtonElement;
            openPetalButton.addEventListener("click", () => {
                this.openDirectory("data/storage/petal");
            });
        }
    }

    private installPackage = async (url: string, version: string, enable: boolean) => {
        url = url.trim();
        version = version.trim();

        try {
            console.log("InstallPackage installPackage", url, version, enable);
            
            let owner: string;
            let repo: string;
            
            // 先尝试匹配完整的 GitHub URL
            const githubUrlMatch = url.match(/^https:\/\/github\.com\/([^\/]+)\/([^\/]+)(\/)?$/);
            if (githubUrlMatch && githubUrlMatch[1] && githubUrlMatch[2]) {
                // 完整 URL 格式
                owner = githubUrlMatch[1];
                repo = githubUrlMatch[2];
                console.log(`Full URL format detected: ${owner}/${repo}`);
            } else {
                // 尝试匹配 user/repo 格式
                const shortFormatMatch = url.match(/^([^\/\s]+)\/([^\/\s]+)$/);
                if (!shortFormatMatch || !shortFormatMatch[1] || !shortFormatMatch[2]) {
                    this.showMessage(this.i18n.invalidUrl, "error");
                    return;
                }
                owner = shortFormatMatch[1];
                repo = shortFormatMatch[2];
                console.log(`Short format detected: ${owner}/${repo}`);
            }
            console.log("Getting repository information...");
            
            // 获取仓库信息
            const repoInfo = await getRepositoryInfo(owner, repo);
            if (!repoInfo) {
                this.showMessage(this.i18n.repoInfoError, "error");
                return;
            }
            
            // 显示仓库信息
            console.log(`Repository: ${repoInfo.full_name}`);
            console.log(`Description: ${repoInfo.description || 'No description'}`);
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
                : '';
            this.showMessage(this.i18n.foundRelease.replace("{tagName}", releaseInfo.tag_name).replace("{publishedAt}", publishedAt), "info");
            
            // 显示 Release 描述（如果有的话）
            if (releaseInfo.body && releaseInfo.body.trim()) {
                console.log(`Release description: ${releaseInfo.body.substring(0, 200)}${releaseInfo.body.length > 200 ? '...' : ''}`);
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
            } else {
                console.error("Failed to download or install package");
            }
            
        } catch (error) {
            console.error("InstallPackage error:", error);
            this.showMessage(this.i18n.downloadFailed.replace("{error}", error.message), "error");
        }
    }

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
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * 重新加载图标
     */
    private async reloadIcon(): Promise<void> {
        try {
            console.log('Calling /api/ui/reloadIcon API...');
            
            const response = await fetch('/api/ui/reloadIcon', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            if (response.ok) {
                console.log('Icon reload API called successfully');
                this.showMessage(this.i18n.iconReloadSuccess, 'info');
                
                // 显示确认对话框，询问是否重新加载界面
                setTimeout(() => {
                    this.showIconReloadDialog();
                }, 200);
            } else {
                console.error(`Failed to call reloadIcon API: ${response.status}`);
                this.showMessage(this.i18n.iconReloadFailed, 'error');
            }
        } catch (error) {
            console.error('Failed to call reloadIcon API:', error);
            this.showMessage(this.i18n.iconReloadFailed, 'error');
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

        dialog.element.querySelector('[data-type="cancel"]').addEventListener('click', () => {
            dialog.destroy();
        });

        dialog.element.querySelector('[data-type="confirm"]').addEventListener('click', () => {
            dialog.destroy();
            // 使用 reloadUI API 刷新界面
            console.log('User confirmed UI reload, calling /api/system/reloadUI API...');
            fetchPost('/api/system/reloadUI');
        });
    }

    /**
     * 显示消息提示
     */
    private showMessage(message: string, type: 'info' | 'error' = 'info') {
        // 使用 SiYuan 的消息提示 API
        showMessage(this.displayName + ": " + message, 10000, type);
        // if (type === 'info') {
        //     console.log(message);
        // } else {
        //     console.error(message);
        // }
    }

    /**
     * 打开目录（仅在 Electron 环境下调用）
     */
    private openDirectory(path: string): void {
        try {
            console.log(`Opening directory: ${path}`);
            
            const { shell } = window.require('electron');
            const workspaceDir = window.siyuan?.config?.system?.workspaceDir || '';
            const fullPath = workspaceDir ? `${workspaceDir}/${path}` : path;
            
            console.log(`Opening directory in Electron: ${fullPath}`);
            shell.openPath(fullPath).then((error: string) => {
                if (error) {
                    console.error(`Failed to open directory: ${error}`);
                    this.showMessage(`无法打开目录：${error}`, 'error');
                } else {
                    console.log(`Directory opened successfully: ${fullPath}`);
                }
            });
        } catch (error) {
            console.error(`Failed to open directory: ${path}`, error);
            this.showMessage(`打开目录失败：${error.message}`, 'error');
        }
    }
}

function isMobile() {
    return !!window.siyuan.mobile;
}