import { i18n } from "./i18n";
import { Dialog } from "siyuan";
import { downloadPackage } from "./download";
import { findPackageZip, getReleaseInfo } from "./github";
import { installPackage, setPackageEnabled } from "./install";
import { message } from "./message";
import type { Logger } from "./tab";

export interface InstallRequest {
    version: string;
    enable: boolean;
    owner: string;
    repo: string;
}

export async function runInstallFromRepo(request: InstallRequest, log: Logger, installInFlight: Set<string>): Promise<void> {
    let repoLockKey = "";
    try {
        const { owner, repo } = request;
        repoLockKey = `${owner}/${repo}`.toLowerCase();
        if (installInFlight.has(repoLockKey)) {
            log(`${repoLockKey} is already in download queue`);
            return;
        }
        installInFlight.add(repoLockKey);

        const releaseInfo = await getReleaseInfo(owner, repo, request.version, log);
        if (!releaseInfo) {
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
                request.enable,
                log
            );
        }

        let autoEnabledText = "";
        if (["plugin", "theme", "icon"].includes(installResult.packageType)) {
            autoEnabledText = request.enable ? i18n.packageInstalledSuccessAuto : i18n.packageInstalledSuccessManual;
            log(i18n.downloadSuccess
                .replace("{autoEnabled}", request.enable ? i18n.autoEnabled : i18n.enableManually));
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
        if (repoLockKey) {
            installInFlight.delete(repoLockKey);
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
