import { Constants, Dialog, Plugin } from "siyuan";
import { i18n, setI18n, type PluginI18n } from "./modules/i18n";
import { message, setMessagePrefix } from "./modules/message";
import { findPackageZip, getReleaseInfo } from "./modules/github";
import { RepoParser } from "./modules/repoParser";
import { downloadPackage } from "./modules/download";
import { installPackage, setPackageEnabled } from "./modules/install";

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
        setMessagePrefix(this.displayName);
        setI18n(this.i18n as PluginI18n);
        this.addTopBar({
            // 图标来源 https://www.svgrepo.com/svg/355075/install
            icon: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path fill="none" stroke="currentColor" stroke-width="2" d="M19,13.5 L19,17.5 L12,22 L5,17.5 L5,13.5 M12,22 L12,13.5 M18.5,8.5 L12,4.5 L15.5,2 L22,6 L18.5,8.5 L18.5,8.5 L18.5,8.5 Z M5.5,8.5 L12,4.5 L8.5,2 L2,6 L5.5,8.5 L5.5,8.5 L5.5,8.5 Z M18.5,9 L12,13 L15.5,15.5 L22,11.5 L18.5,9 L18.5,9 L18.5,9 Z M5.5,9 L12,13 L8.5,15.5 L2,11.5 L5.5,9 L5.5,9 Z"/>
</svg>`,
            title: i18n.title,
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
        // 打开开发者工具
        electron?.ipcRenderer?.send(Constants.SIYUAN_CMD, "openDevTools");

        const dialog = new Dialog({
            title: i18n.title,
            width: isMobile() ? "92vw" : "520px",
            content: 
                `<div class="b3-dialog__content">
                    ${i18n.urlLabel}
                    <div class="fn__hr"></div>
                    <input data-type="url" class="b3-text-field fn__block" value="" placeholder="${i18n.urlPlaceholder}" spellcheck="false">
                    <div data-type="repo-preview" class="b3-label__text">${i18n.repoPreviewTip}</div>
                    <div class="fn__hr"></div>
                    ${i18n.versionLabel}
                    <div class="fn__hr"></div>
                    <input data-type="version" class="b3-text-field fn__block" value="" placeholder="${i18n.versionPlaceholder}" spellcheck="false">
                    <div class="fn__hr"></div>
                    ${i18n.enableLabel}
                    <div class="fn__hr"></div>
                    <select data-type="enable" class="b3-select fn__block">
                        <option value="enable">${i18n.enableOptionEnable}</option>
                        <option value="disable">${i18n.enableOptionDisable}</option>
                    </select>
                    ${
                        // 只在 Electron 环境下显示打开目录按钮
                        !electron ? "" : `
                        <div class="fn__hr"></div>
                        <div class="fn__flex" style="gap: 8px;">
                            <button data-type="open-plugins" class="b3-button b3-button--outline">${i18n.openPluginsDir}</button>
                            <button data-type="open-petal" class="b3-button b3-button--outline">${i18n.openPetalDir}</button>
                        </div>`
                    }
                </div>
                <div class="b3-dialog__action">
                    <button data-type="cancel" class="b3-button b3-button--cancel">${i18n.cancel}</button><div class="fn__space"></div>
                    <button data-type="confirm" class="b3-button b3-button--text">${i18n.confirm}</button>
                </div>`,
        });
        // TODO 支持记忆历史安装记录，增加一个按钮打开菜单可以填历史安装的仓库 URL 和版本号
        const urlInput = dialog.element.querySelector("input[data-type='url']") as HTMLInputElement;
        const repoPreviewEl = dialog.element.querySelector("div[data-type='repo-preview']") as HTMLDivElement;
        const versionInput = dialog.element.querySelector("input[data-type='version']") as HTMLInputElement;
        const enableSelect = dialog.element.querySelector("select[data-type='enable']") as HTMLSelectElement;

        const repoUrlController = new RepoParser(urlInput, repoPreviewEl);
        urlInput.addEventListener("input", () => repoUrlController.refresh());
        
        const getEnableValue = () => enableSelect.value === "enable";
        
        dialog.bindInput(urlInput, () => {
            this.installPackage(dialog, urlInput.value, versionInput.value, getEnableValue(), repoUrlController);
        });
        dialog.bindInput(versionInput, () => {
            this.installPackage(dialog, urlInput.value, versionInput.value, getEnableValue(), repoUrlController);
        });
        urlInput.select();

        const cancelButton = dialog.element.querySelector("button[data-type='cancel']") as HTMLButtonElement;
        cancelButton.addEventListener("click", () => {
            dialog.destroy();
        });
        const confirmButton = dialog.element.querySelector("button[data-type='confirm']") as HTMLButtonElement;
        confirmButton.addEventListener("click", () => {
            this.installPackage(dialog, urlInput.value, versionInput.value, getEnableValue(), repoUrlController);
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

    private installPackage = async (
        dialog: Dialog,
        url: string,
        version: string,
        enable: boolean,
        repoUrlController: RepoParser
    ) => {
        url = url.trim();
        version = version.trim();

        const parsed = await repoUrlController.ownerRepoForUrl(url);
        if (!parsed) {
            message(i18n.invalidUrl);
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
            console.log("install package: url=[" + url + "], version=[" + version + "], enable=[" + enable + "]");
            const releaseInfo = await getReleaseInfo(owner, repo, version);
            if (!releaseInfo) {
                message(i18n.releaseInfoError.replace("{version}", version || "latest"));
                return;
            }
            // Release 信息
            console.log("Release description:", releaseInfo.body?.substring(0, 200) + (releaseInfo.body?.length > 200 ? "..." : ""));

            message(i18n.foundRelease
                .replace("{tagName}", releaseInfo.tag_name)
                .replace("{publishedAt}", (
                    releaseInfo.published_at ? i18n.publishedOn.replace("{date}", new Date(releaseInfo.published_at).toLocaleDateString()) : ""
                )),
                true
            );

            // 查找包文件
            const packageZip = findPackageZip(releaseInfo.assets);
            if (!packageZip) {
                message(i18n.packageZipNotFound);
                return;
            }

            // TODO 重构到这里
            const LARGE_PACKAGE_THRESHOLD_BYTES = 20 * 1024 * 1024;
            if (packageZip.size > LARGE_PACKAGE_THRESHOLD_BYTES) {
                // 超过此大小的 package.zip 下载前需用户手动确认（20 MB）
                const proceed = await this.confirmDownload(packageZip.name, packageZip.size, LARGE_PACKAGE_THRESHOLD_BYTES);
                if (!proceed) {
                    return;
                }
            }

            message(i18n.downloading.replace("{fileName}", packageZip.name).replace("{fileSize}", formatFileSize(packageZip.size)), true);
            const downloadResult = await downloadPackage(packageZip.browser_download_url, packageZip.name);
            if (!downloadResult) {
                return;
            }

            const installResult = await installPackage(downloadResult);
            if (!installResult) {
                return;
            }

            if (installResult.packageType && installResult.packageName) {
                await setPackageEnabled(
                    installResult.packageType,
                    installResult.packageName,
                    enable
                );
            }

            let autoEnabledText = "";
            if (["plugin", "theme", "icon"].includes(installResult.packageType)) {
                // 挂件和模板没有「启用」的概念
                autoEnabledText = enable ? i18n.packageInstalledSuccessAuto : i18n.packageInstalledSuccessManual;
                console.log(i18n.downloadSuccess
                    .replace("{autoEnabled}", enable ? i18n.autoEnabled : i18n.enableManually
                ));
            }
            message(i18n.packageInstalledSuccess
                .replace("{packageType}", installResult.packageType)
                .replace("{packageName}", installResult.packageName)
                .replace("{autoEnabled}", autoEnabledText),
                true
            );

            dialog.destroy();
            return;
        } catch (error) {
            console.error("InstallPackage error:", error);
            message(i18n.downloadFailed.replace("{error}", error instanceof Error ? error.message : String(error)));
        } finally {
            this.installInFlight.delete(repoLockKey);
        }
    };

    /**
     * 大型包下载前弹出确认框
     * 
     * @param fileName - 文件名
     * @param sizeBytes - 文件大小
     * @param thresholdBytes - 阈值大小
     * @returns 是否确认下载
     */
    private confirmDownload(fileName: string, sizeBytes: number, thresholdBytes: number): Promise<boolean> {
        return new Promise((resolve) => {
            const finish = (ok: boolean) => {
                confirmDialog.destroy();
                resolve(ok);
            };
            const confirmDialog = new Dialog({
                title: i18n.largePackageConfirmTitle,
                width: isMobile() ? "92vw" : "480px",
                content:
                    `<div class="b3-dialog__content">
                        <div data-type="msg" class="b3-label__text">
                        ${i18n.largePackageConfirmContent
                            .replace("{fileName}", fileName)
                            .replace("{fileSize}", formatFileSize(sizeBytes))
                            .replace("{thresholdBytes}", formatFileSize(thresholdBytes))
                        }
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button data-type="cancel" class="b3-button b3-button--cancel">${i18n.cancel}</button><div class="fn__space"></div>
                        <button data-type="confirm" class="b3-button b3-button--text">${i18n.confirm}</button>
                    </div>`,
                destroyCallback: () => {
                    finish(false);
                },
            });
            confirmDialog.element.querySelector("button[data-type='cancel']")?.addEventListener("click", () => finish(false));
            confirmDialog.element.querySelector("button[data-type='confirm']")?.addEventListener("click", () => finish(true));
        });
    }

    /**
     * 打开目录（仅在 Electron 环境下调用）
     */
    private async openDirectory(relPath: string): Promise<void> {
        try {
            console.log(`Opening directory: ${relPath}`);

            if (!electron) {
                message(i18n.openDirectoryFailed + i18n.openDirectoryNoElectron);
                return;
            }

            const workspaceDir = (window.siyuan.config.system.workspaceDir ?? "").trim();
            if (!workspaceDir) {
                message(i18n.openDirectoryFailed + i18n.openDirectoryNoWorkspace);
                return;
            }

            const fullPath = `${workspaceDir}/${relPath}`;

            if (electron.ipcRenderer) {
                // 优先走思源主进程 ipc，避免渲染进程使用 shell.openPath 时资源管理器在后台打开。
                electron.ipcRenderer.send(Constants.SIYUAN_CMD, {
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
            message(i18n.openDirectoryFailed + detail);
        }
    }
}

function isMobile() {
    return !!window.siyuan.mobile;
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
