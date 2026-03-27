import "./index.scss";
import { Constants, Custom, Dialog, Plugin, openTab } from "siyuan";
import { i18n, setI18n, type PluginI18n } from "./modules/i18n";
import { message, setMessagePrefix } from "./modules/message";
import { findPackageZip, getReleaseInfo, setOpenPluginSettingHandler } from "./modules/github";
import { createSetting, loadSetting } from "./modules/setting";
import { RepoParser } from "./modules/repoParser";
import { downloadPackage } from "./modules/download";
import { installPackage, setPackageEnabled } from "./modules/install";
import {
    initInstallPanel,
    INSTALL_PACKAGE_ICON_ID,
    INSTALL_PACKAGE_ICON_SYMBOL,
    INSTALL_TAB_TYPE,
} from "./modules/tab";

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
        setOpenPluginSettingHandler(() => this.openSetting());

        try {
            this.setting = createSetting(this);
        } catch (error) {
            console.error("Failed to create setting:", error);
            return;
        }

        this.addIcons(INSTALL_PACKAGE_ICON_SYMBOL);

        const plugin = this;
        this.addTab({
            type: INSTALL_TAB_TYPE,
            init(this: Custom) {
                initInstallPanel(this, {
                    installPackage: (...args) => plugin.installPackage(...args),
                    openDirectory: (relPath) => void plugin.openDirectory(relPath),
                    openDevTools: () => plugin.openDevTools(),
                    openPluginSettings: () => plugin.openSetting(),
                });
            },
        });

        this.addTopBar({
            icon: INSTALL_PACKAGE_ICON_ID,
            title: i18n.title,
            position: "right",
            callback: this.topBarHandler,
        });

        console.log(this.displayName, "plugin loaded");
    }

    onLayoutReady() {
        loadSetting(this);
    }

    onDataChanged() {
        // 避免数据同步时重启插件导致自定义页签内容样式抖动
        loadSetting(this);
    }

    onunload() {
        // console.log("InstallPackage unloaded");
    }

    uninstall() {
        // 删除 Token 密文文件夹
        this.removeData("secret");

        console.log(this.displayName, "plugin uninstalled");
    }

    private topBarHandler = () => {
        openTab({
            app: this.app,
            custom: {
                id: this.name + INSTALL_TAB_TYPE,
                icon: INSTALL_PACKAGE_ICON_ID,
                title: i18n.title,
                data: {},
            },
        });
    };

    /**
     * 打开开发者工具（仅在 Electron 环境下调用）
     */
    private openDevTools(): void {
        electron?.ipcRenderer?.send(Constants.SIYUAN_CMD, "openDevTools");
    }

    private installPackage = async (
        urlInput: HTMLInputElement,
        versionInput: HTMLInputElement,
        enable: boolean,
        repoUrlController: RepoParser,
        log: (...args: unknown[]) => void
    ) => {
        const url = urlInput.value.trim();
        const version = versionInput.value.trim();
        let repoLockKey = "";

        try {
            const parsed = await repoUrlController.ownerRepoForUrl(url);
            if (!parsed) {
                message(i18n.invalidUrl);
                log(i18n.invalidUrl);
                return;
            }
            const { owner, repo } = parsed;

            repoLockKey = `${owner}/${repo}`.toLowerCase();
            if (this.installInFlight.has(repoLockKey)) {
                log(`${repoLockKey} is already in download queue`);
                return;
            }
            this.installInFlight.add(repoLockKey);

            log("install package: url=[" + url + "], version=[" + version + "], enable=[" + enable + "]");
            const releaseInfo = await getReleaseInfo(owner, repo, version, log);
            if (!releaseInfo) {
                message(i18n.releaseInfoError.replace("{version}", version || "latest"));
                log(i18n.releaseInfoError.replace("{version}", version || "latest"));
                return;
            }
            // Release 信息
            log("Release description: " + (releaseInfo.body?.substring(0, 200) + (releaseInfo.body?.length > 200 ? "..." : "")));

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
                log(i18n.packageZipNotFound);
                return;
            }

            // TODO 重构到这里
            const LARGE_PACKAGE_THRESHOLD_BYTES = 20 * 1024 * 1024;
            if (packageZip.size > LARGE_PACKAGE_THRESHOLD_BYTES) {
                // 超过此大小的 package.zip 下载前需用户手动确认（20 MB）
                const proceed = await this.confirmDownload(packageZip.name, packageZip.size, LARGE_PACKAGE_THRESHOLD_BYTES);
                if (!proceed) {
                    log("User canceled download");
                    return;
                }
            }

            message(i18n.downloading.replace("{fileName}", packageZip.name).replace("{fileSize}", formatFileSize(packageZip.size)), true);
            log(i18n.downloading.replace("{fileName}", packageZip.name).replace("{fileSize}", formatFileSize(packageZip.size)));
            const downloadResult = await downloadPackage(packageZip.browser_download_url, packageZip.name, log);
            if (!downloadResult) {
                log(i18n.downloadFailed.replace("{error}", "download package failed"));
                return;
            }

            const installResult = await installPackage(downloadResult, log);
            if (!installResult) {
                log(i18n.packageInstallFailed);
                return;
            }

            if (installResult.packageType && installResult.packageName) {
                await setPackageEnabled(
                    installResult.packageType,
                    installResult.packageName,
                    enable,
                    log
                );
            }

            let autoEnabledText = "";
            if (["plugin", "theme", "icon"].includes(installResult.packageType)) {
                // 挂件和模板没有「启用」的概念
                autoEnabledText = enable ? i18n.packageInstalledSuccessAuto : i18n.packageInstalledSuccessManual;
                log(i18n.downloadSuccess
                    .replace("{autoEnabled}", enable ? i18n.autoEnabled : i18n.enableManually
                ));
            }
            message(i18n.packageInstalledSuccess
                .replace("{packageType}", installResult.packageType)
                .replace("{packageName}", installResult.packageName)
                .replace("{autoEnabled}", autoEnabledText),
                true
            );
            log(i18n.packageInstalledSuccess
                .replace("{packageType}", installResult.packageType)
                .replace("{packageName}", installResult.packageName)
                .replace("{autoEnabled}", autoEnabledText));

            return;
        } catch (error) {
            log("InstallPackage error:", error);
            message(i18n.downloadFailed.replace("{error}", error instanceof Error ? error.message : String(error)));
        } finally {
            if (repoLockKey) {
                this.installInFlight.delete(repoLockKey);
            }
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
            let result = false;
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
                    resolve(result);
                },
            });
            confirmDialog.element.querySelector("button[data-type='cancel']")?.addEventListener("click", () => {
                confirmDialog.destroy();
            });
            confirmDialog.element.querySelector("button[data-type='confirm']")?.addEventListener("click", () => {
                result = true;
                confirmDialog.destroy();
            });
        });
    }

    /**
     * 打开目录（仅在 Electron 环境下调用）
     */
    private async openDirectory(relPath: string): Promise<void> {
        try {
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
