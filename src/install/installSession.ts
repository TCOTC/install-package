import { i18n } from "../infra/i18n";
import { confirmDialog } from "../infra/dialog";
import { repoKeyFromOwnerRepo } from "../infra/repoKey";
import { downloadPackage, type DownloadProgressCallback } from "../github/download";
import { findPackageZip, getReleaseInfo } from "../github/github";
import { installPackage, setPackageEnabled } from "./install";
import { recordInstallHistory } from "./installHistory";
import { isSelfRepo, reportSelfInstallBlock } from "./selfPackage";
import type { Logger } from "../infra/logger";

export interface InstallRequest {
    owner: string;
    repo: string;
    version: string;
    enableAfterInstall: boolean;
}

export interface RunInstallOptions {
    /** 下载阶段的进度回调（已接收字节 / 总字节）；本地安装阶段不再触发 */
    onDownloadProgress?: DownloadProgressCallback;
    /** 下载结束、即将进入本地安装阶段时触发（本地安装由内核接口完成，拿不到字节级进度） */
    onDownloadComplete?: () => void;
}

/**
 * 同仓仅一条进行中的安装：再次发起（含同版本重试、换版本）均会 abort 上一轮并接管 Map。
 * 同版本进行中时面板应禁用安装键；`startInstall` 亦做 `isSameTargetInstalling` 防护以免回车等绕过按钮。
 */
type ActiveInstallEntry = { controller: AbortController; version: string };

const activeInstallByRepo = new Map<string, ActiveInstallEntry>();

/**
 * 该 owner / repo 是否正在安装且进行中版本与参数一致（跨面板共用 `activeInstallByRepo`）
 */
export function isSameTargetInstalling(owner: string, repo: string, version: string): boolean {
    const entry = activeInstallByRepo.get(repoKeyFromOwnerRepo(owner, repo));
    return entry !== undefined && entry.version === version;
}

/** 该仓库是否有一条进行中的安装（与版本无关，同仓互斥） */
export function isRepoInstalling(owner: string, repo: string): boolean {
    // 存在时说明有进行中的安装，还没执行到 finally
    return activeInstallByRepo.has(repoKeyFromOwnerRepo(owner, repo));
}

/** 中止指定仓库的进行中安装 */
export function abortInstall(owner: string, repo: string): void {
    activeInstallByRepo.get(repoKeyFromOwnerRepo(owner, repo))?.controller.abort();
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

/**
 * 自我安装的前置校验
 *
 * 开发环境下安装自身会把插件目录里的源码替换成发布包，因此直接禁止；
 * 另外只允许整体重构之后的第一版，避免把重构之前的旧架构覆盖到当前代码上。
 * 限制原因由 selfPackage 统一写进日志（与面板共用去重），此处只关心能否安装
 */
function confirmSelfInstall(version: string, log: Logger): boolean {
    // 调用前 isSelfRepo 已载入自身包信息，这里取到的原因不会再触发额外的目录读取
    return reportSelfInstallBlock(log, version) === "";
}

/**
 * 执行一次安装请求（下载 release 包并安装）。
 * @returns `true` 成功（需提示）、`false` 失败（需提示）、`null` 中性（取消 / 被中止等，不提示）
 */
export async function runInstall(request: InstallRequest, log: Logger, options?: RunInstallOptions): Promise<boolean | null> {
    const repoLockKey = repoKeyFromOwnerRepo(request.owner, request.repo);
    const installAbort = new AbortController();
    const signal = installAbort.signal;
    try {
        const previous = activeInstallByRepo.get(repoLockKey);
        if (previous !== undefined && previous.controller !== installAbort) {
            previous.controller.abort();
        }
        activeInstallByRepo.set(repoLockKey, { controller: installAbort, version: request.version });
        notifyActiveInstallChange();

        // 安装自身时启用状态由内核接管（安装完会直接重载本插件），不再走安装后的启停步骤；
        // 但需要先拦住开发环境与过低版本，避免覆盖插件源码
        const installSelf = await isSelfRepo(request.owner, request.repo, log);
        if (installSelf && !confirmSelfInstall(request.version, log)) {
            return false;
        }

        const releaseInfo = await getReleaseInfo(request.owner, request.repo, request.version, log, signal);
        if (signal.aborted) {
            return null;
        }
        if (!releaseInfo) {
            log.warn(i18n.releaseInfoError.replace("{version}", request.version || "latest"));
            return false;
        }
        log.info(i18n.foundRelease
            .replace("{tagName}", releaseInfo.tag_name)
            .replace("{publishedAt}", releaseInfo.published_at ? i18n.publishedOn.replace("{date}", new Date(releaseInfo.published_at).toLocaleDateString()) : ""),
        );

        const packageZip = findPackageZip(releaseInfo.assets);
        if (!packageZip) {
            log.warn(i18n.packageZipNotFound);
            return false;
        }

        const largePackageThresholdBytes = 20 * 1024 * 1024;
        if (packageZip.size > largePackageThresholdBytes) {
            const proceed = await confirmLargeDownload(packageZip.name, packageZip.size, largePackageThresholdBytes);
            if (!proceed) {
                return null;
            }
        }

        // 下载进度以「原地刷新的进度行」呈现，初始文本即原有的下载提示
        const downloadProgress = log.progress(
            i18n.downloading
                .replace("{fileName}", packageZip.name)
                .replace("{fileSize}", formatFileSize(packageZip.size)),
        );
        let lastProgressAt = 0;
        let lastProgressPercent = -1;
        const downloadResult = await downloadPackage(
            packageZip.browser_download_url,
            packageZip.name,
            log,
            installAbort,
            {
                totalBytes: packageZip.size,
                onProgress: (loaded, total) => {
                    const percent = total > 0 ? Math.min(loaded / total, 1) : 0;
                    const now = Date.now();
                    // 节流：百分比未变化时不刷新；有变化时也限制在 100ms 一次，100% 始终即时上报
                    if (percent < 1 && (percent === lastProgressPercent || now - lastProgressAt < 100)) {
                        return;
                    }
                    lastProgressAt = now;
                    lastProgressPercent = percent;
                    downloadProgress.update(
                        i18n.downloadProgress
                            .replace("{fileName}", packageZip.name)
                            .replace("{loaded}", formatFileSize(loaded))
                            .replace("{total}", formatFileSize(total))
                            .replace("{percent}", String(Math.floor(percent * 100))),
                    );
                    options?.onDownloadProgress?.(loaded, total);
                },
            },
        );
        if (!downloadResult.ok) {
            switch (downloadResult.reason) {
                case "aborted":
                    // 用户主动中断属中性结果，不提示
                    downloadProgress.discard();
                    return null;
                case "network":
                    // 失败原因就地写在进度行上，避免再追一条内容重复的告警；
                    // 网络类失败与「文件不是 ZIP」是两回事，分别给出对应提示
                    downloadProgress.finish(
                        downloadResult.status !== undefined
                            ? i18n.downloadHttpFailed.replace("{status}", String(downloadResult.status))
                            : downloadResult.loadedBytes > 0
                                ? i18n.downloadInterruptedAt
                                    .replace("{loaded}", formatFileSize(downloadResult.loadedBytes))
                                    .replace("{total}", formatFileSize(downloadResult.totalBytes))
                                : i18n.downloadInterrupted,
                        { warn: true },
                    );
                    return false;
                case "unrecognized":
                    // 已取回完整响应，但下载地址不是可识别的仓库地址
                    downloadProgress.finish(i18n.packageNameFromUrlFailed, { warn: true });
                    return false;
                default:
                    // 已拿到完整响应，但内容不是有效 ZIP
                    downloadProgress.finish(i18n.fileValidationFailed, { warn: true });
                    return false;
            }
        }

        // 下载已完成，此处的中止说明用户在最后一刻点了「中断安装」，后续内核安装不再受理
        if (signal.aborted) {
            downloadProgress.discard();
            return null;
        }
        downloadProgress.finish(
            i18n.downloadComplete
                .replace("{fileName}", packageZip.name)
                .replace("{fileSize}", formatFileSize(downloadResult.blob.size)),
        );
        options?.onDownloadComplete?.();

        const installResult = await installPackage(downloadResult, log);
        if (!installResult) {
            // 失败原因已由 installPackage 分类打印，此处不再重复输出
            return false;
        }

        // 自身安装时内核会在安装完成的同时重载本插件，此处不能再用旧实例去改启用状态，
        // 否则旧实例会把刚装上的自己禁用掉；此路径下插件必然处于启用状态
        if (!installSelf) {
            await setPackageEnabled(installResult.packageType, installResult.packageName, request.enableAfterInstall, log);
        }

        // 插件、主题、图标的启用状态拼进下面那一行成功日志；挂件与模板没有启用状态，留空
        let autoEnabledText = "";
        if (["plugin", "theme", "icon"].includes(installResult.packageType)) {
            const enabled = request.enableAfterInstall || installSelf;
            autoEnabledText = enabled ? i18n.packageInstalledSuccessAuto : i18n.packageInstalledSuccessManual;
        }
        const installSuccess = i18n.packageInstalledSuccess
            .replace("{packageType}", installResult.packageType)
            .replace("{packageName}", installResult.packageName)
            .replace("{autoEnabled}", autoEnabledText);
        log.info(installSuccess);
        // 只在这一刻记入历史：此前的任何失败都不算「装过」，写入失败不影响本次结果。
        // `request.version` 的值一直就是 Git Tag（面板的版本控件以 tag 为值）
        void recordInstallHistory(request.owner, request.repo, request.version);
        return true;
    } catch (error) {
        log.warn(i18n.installationFailed, error);
        return false;
    } finally {
        const cur = activeInstallByRepo.get(repoLockKey);
        if (cur?.controller === installAbort) {
            activeInstallByRepo.delete(repoLockKey);
            notifyActiveInstallChange();
        }
    }
}

function confirmLargeDownload(fileName: string, sizeBytes: number, thresholdBytes: number): Promise<boolean> {
    return confirmDialog({
        title: i18n.largePackageConfirmTitle,
        content:
            `<div data-type="msg" class="b3-label__text">
                    ${i18n.largePackageConfirmContent
                        .replace("{fileName}", fileName)
                        .replace("{fileSize}", formatFileSize(sizeBytes))
                        .replace("{thresholdBytes}", formatFileSize(thresholdBytes))
                    }
                    </div>`,
    });
}

function formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
