import { i18n } from "./i18n";
import { Dialog } from "siyuan";
import { downloadPackage } from "./download";
import { findPackageZip, getReleaseInfo } from "./github";
import { installPackage, setPackageEnabled } from "./install";
import { message } from "./message";
import type { Logger } from "./panel";

export interface InstallRequest {
    owner: string;
    repo: string;
    version: string;
    enableAfterInstall: boolean;
}

/**
 * 同仓仅一条进行中的安装：再次发起（含同版本重试、换版本）均会 abort 上一轮并接管 Map。
 * 同版本进行中时面板应禁用安装键；`startInstall` 亦做 `isSameTargetInstalling` 防护以免回车等绕过按钮。
 */
type ActiveInstallEntry = { controller: AbortController; version: string };

const activeInstallByRepo = new Map<string, ActiveInstallEntry>();

/** 该 owner / repo 是否正在安装且进行中版本与参数一致（跨面板共用 `activeInstallByRepo`） */
export function isSameTargetInstalling(owner: string, repo: string, version: string): boolean {
    const key = `${owner}/${repo}`.toLowerCase();
    const entry = activeInstallByRepo.get(key);
    return entry !== undefined && entry.version === version;
}

const installUiLockListeners = new Set<() => void>();

export function subscribeActiveInstallChange(listener: () => void): () => void {
    installUiLockListeners.add(listener);
    return () => installUiLockListeners.delete(listener);
}

function notifyActiveInstallChange(): void {
    for (const fn of installUiLockListeners) {
        try {
            fn();
        } catch {
            /* 忽略面板回调异常 */
        }
    }
}

/** 插件关闭时中止所有进行中的安装，避免关闭后仍访问已移除的 UI */
export function abortAllActiveInstalls(): void {
    for (const { controller } of activeInstallByRepo.values()) {
        controller.abort();
    }
}

export async function runInstall(request: InstallRequest, log: Logger): Promise<void> {
    const repoLockKey = `${request.owner}/${request.repo}`.toLowerCase();
    const installAbort = new AbortController();
    const signal = installAbort.signal;
    try {
        const previous = activeInstallByRepo.get(repoLockKey);
        if (previous !== undefined && previous.controller !== installAbort) {
            previous.controller.abort();
        }
        activeInstallByRepo.set(repoLockKey, { controller: installAbort, version: request.version });
        notifyActiveInstallChange();

        const releaseInfo = await getReleaseInfo(request.owner, request.repo, request.version, log, signal);
        if (!releaseInfo) {
            if (signal.aborted) {
                return;
            }
            const releaseError = i18n.releaseInfoError.replace("{version}", request.version || "latest");
            message(releaseError);
            log(releaseError);
            return;
        }
        log("Release description: " + (releaseInfo.body?.substring(0, 200) + (releaseInfo.body?.length > 200 ? "..." : "")));
        message(i18n.foundRelease
            .replace("{tagName}", releaseInfo.tag_name)
            .replace("{publishedAt}", (
                releaseInfo.published_at ? i18n.publishedOn.replace("{date}", new Date(releaseInfo.published_at).toLocaleDateString()) : ""
            )), true);

        const packageZip = findPackageZip(releaseInfo.assets);
        if (!packageZip) {
            message(i18n.packageZipNotFound);
            log(i18n.packageZipNotFound);
            return;
        }

        const largePackageThresholdBytes = 20 * 1024 * 1024;
        if (packageZip.size > largePackageThresholdBytes) {
            const proceed = await confirmLargeDownload(packageZip.name, packageZip.size, largePackageThresholdBytes);
            if (!proceed) {
                log("User canceled download");
                return;
            }
        }

        message(i18n.downloading
            .replace("{fileName}", packageZip.name)
            .replace("{fileSize}", formatFileSize(packageZip.size)), true);
        const downloadResult = await downloadPackage(packageZip.browser_download_url, packageZip.name, log, installAbort);
        if (!downloadResult) {
            if (signal.aborted) {
                return;
            }
            log(i18n.downloadFailed.replace("{error}", "download package failed"));
            return;
        }

        if (signal.aborted) {
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
                request.enableAfterInstall,
                log
            );
        }

        let autoEnabledText = "";
        if (["plugin", "theme", "icon"].includes(installResult.packageType)) {
            autoEnabledText = request.enableAfterInstall ? i18n.packageInstalledSuccessAuto : i18n.packageInstalledSuccessManual;
            log(i18n.downloadSuccess
                .replace("{autoEnabled}", request.enableAfterInstall ? i18n.autoEnabled : i18n.enableManually));
        }
        const installSuccess = i18n.packageInstalledSuccess
            .replace("{packageType}", installResult.packageType)
            .replace("{packageName}", installResult.packageName)
            .replace("{autoEnabled}", autoEnabledText);
        message(installSuccess, true);
        log(installSuccess);
    } catch (error) {
        log("InstallPackage error:", error);
        message(i18n.downloadFailed.replace("{error}", error instanceof Error ? error.message : String(error)));
    } finally {
        const cur = activeInstallByRepo.get(repoLockKey);
        if (cur?.controller === installAbort) {
            activeInstallByRepo.delete(repoLockKey);
            notifyActiveInstallChange();
        }
    }
}

function confirmLargeDownload(fileName: string, sizeBytes: number, thresholdBytes: number): Promise<boolean> {
    return new Promise((resolve) => {
        let result = false;
        const confirmDialog = new Dialog({
            title: i18n.largePackageConfirmTitle,
            width: window.siyuan.mobile ? "92vw" : "480px",
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

function formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
