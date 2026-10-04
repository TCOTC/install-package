/**
 * 插件自身包的识别与自我安装策略
 *
 * 自身仓库地址取自本插件安装目录内的 plugin.json，与内核识别集市包的来源一致；
 * 「开发环境」按目录内是否存在源码或工程文件判断：集市发布的包由 webpack 组装，只含
 * index.js、index.css、i18n 等产物，不会带这些文件。
 */

import { i18n } from "../infra/i18n";
import { getFile, readDir } from "../infra/kernelClient";
import type { Logger } from "../ui/logger";

/**
 * 允许安装自身的最低版本：整体重构之后的第一版
 *
 * 低于该版本的包使用重构前的旧架构（目录结构、配置与接口都不一样），覆盖安装会把当前代码换成旧实现
 */
export const MIN_SELF_INSTALL_VERSION = "1.0.0";

/** 插件目录内命中任一标记即视为开发环境 */
const DEV_ENVIRONMENT_MARKERS = [
    ".git",
    "src",
    "node_modules",
    "package.json",
    "tsconfig.json",
    "webpack.config.js",
];

interface SelfPackageInfo {
    /** 自身插件仓库键（owner/repo 小写形式）；无法确定时为空串 */
    repoKey: string;
    /** 插件目录是否为开发环境 */
    devEnvironment: boolean;
}

const UNKNOWN_SELF_PACKAGE: SelfPackageInfo = { repoKey: "", devEnvironment: false };

let selfName = "";
let selfInfo: SelfPackageInfo | null = null;
let selfInfoLoading: Promise<SelfPackageInfo> | null = null;
/** 最近一次写进日志的自我安装限制原因，避免面板与安装流程重复报同一行 */
let lastReportedBlockReason = "";

/** 由插件入口在 onload 时传入包名，并清空上一次载入的缓存 */
export function initSelfPackage(pluginName: string): void {
    selfName = pluginName;
    selfInfo = null;
    selfInfoLoading = null;
    lastReportedBlockReason = "";
}

/** 归一化为 owner/repo 小写形式的仓库键 */
function normalizeRepoKey(owner: string, repo: string): string {
    return `${owner}/${repo}`.toLowerCase();
}

/** 从 plugin.json 的 url 解析仓库键，兼容 https 与 ssh 两种地址写法 */
function repoKeyFromPluginUrl(url: string): string {
    const match = url.match(/github\.com[/:]([^/]+)\/([^/#?]+)/i);
    if (!match) {
        return "";
    }
    return normalizeRepoKey(match[1], match[2].replace(/\.git$/i, ""));
}

/** 读取插件安装目录的文件列表与元数据；任一步失败都按「未知仓库、非开发环境」处理 */
async function loadSelfPackageInfo(log: Logger): Promise<SelfPackageInfo> {
    if (selfName === "") {
        return UNKNOWN_SELF_PACKAGE;
    }
    const installPath = `data/plugins/${selfName}`;
    const entries = await readDir(installPath, log);
    if (!entries) {
        return UNKNOWN_SELF_PACKAGE;
    }
    const names = new Set(entries.map((entry) => entry.name));
    const manifest = await getFile(`${installPath}/plugin.json`);
    let repoKey = "";
    if (manifest.ok) {
        try {
            const parsed = JSON.parse(manifest.content) as { url?: unknown };
            repoKey = typeof parsed.url === "string" ? repoKeyFromPluginUrl(parsed.url) : "";
        } catch {
            // 元数据不是合法 JSON 时按未知仓库处理
        }
    }
    return {
        repoKey,
        devEnvironment: DEV_ENVIRONMENT_MARKERS.some((marker) => names.has(marker)),
    };
}

/** 载入自身包信息，同一插件实例只请求一次 */
export function getSelfPackageInfo(log: Logger): Promise<SelfPackageInfo> {
    if (selfInfo) {
        return Promise.resolve(selfInfo);
    }
    selfInfoLoading ??= loadSelfPackageInfo(log).then((info) => {
        selfInfo = info;
        return info;
    });
    return selfInfoLoading;
}

/**
 * 同步判断目标仓库是否为插件自身仓库
 *
 * 自身包信息尚未载入时返回 false，此时界面按普通集市包展示，安装流程内的异步校验会兜住
 */
export function isSelfRepoKeySync(ownerRepoKey: string): boolean {
    const repoKey = selfInfo?.repoKey ?? "";
    return repoKey !== "" && ownerRepoKey.toLowerCase() === repoKey;
}

/** 判断目标仓库是否为插件自身仓库 */
export async function isSelfRepo(owner: string, repo: string, log: Logger): Promise<boolean> {
    const { repoKey } = await getSelfPackageInfo(log);
    return repoKey !== "" && repoKey === normalizeRepoKey(owner, repo);
}

/** 本插件当前是否运行在开发环境中 */
export async function isSelfDevEnvironment(log: Logger): Promise<boolean> {
    return (await getSelfPackageInfo(log)).devEnvironment;
}

/** 按已载入信息同步判断开发环境；尚未载入时返回 false */
export function isSelfDevEnvironmentSync(): boolean {
    return selfInfo?.devEnvironment ?? false;
}

/** 把 tag 解析为三段数字版本；无法解析时返回 null */
function parseVersionTag(tag: string): number[] | null {
    const match = tag.trim().match(/^[vV]?(\d+)\.(\d+)\.(\d+)/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** tag 是否达到自我安装的最低版本；无法解析的 tag 一律视为不满足 */
export function isSelfInstallableVersion(tag: string): boolean {
    const version = parseVersionTag(tag);
    const selfMinimum = parseVersionTag(MIN_SELF_INSTALL_VERSION);
    if (!version || !selfMinimum) {
        return false;
    }
    for (let i = 0; i < selfMinimum.length; i++) {
        if (version[i] !== selfMinimum[i]) {
            return version[i] > selfMinimum[i];
        }
    }
    return true;
}

/** 版本低于自我安装最低版本时的提示文案 */
export function selfInstallVersionTooOldText(version: string): string {
    return i18n.selfInstallVersionTooOld
        .replace("{version}", version)
        .replace("{min}", MIN_SELF_INSTALL_VERSION);
}

/**
 * 依据已载入的自身包信息给出「自我安装被禁」的原因文案，可安装时返回空串
 *
 * 版本为空时返回空串：此时安装键本就因缺少版本而禁用，无需把原因说成版本过低
 */
export function selfInstallDisabledText(version: string): string {
    if (isSelfDevEnvironmentSync()) {
        return i18n.selfInstallBlockedInDev;
    }
    if (version !== "" && !isSelfInstallableVersion(version)) {
        return selfInstallVersionTooOldText(version);
    }
    return "";
}

/**
 * 把自我安装的限制原因写进日志，并返回该原因（可安装时返回空串）
 *
 * 面板判定出限制时会先写一行，点击安装触发的校验复用同一原因，不再重复输出；
 * 原因变为空时重置记录，重新选中受限版本后仍会提示
 */
export function reportSelfInstallBlock(log: Logger, version: string): string {
    const reason = selfInstallDisabledText(version);
    if (reason === "") {
        lastReportedBlockReason = "";
        return "";
    }
    if (reason !== lastReportedBlockReason) {
        lastReportedBlockReason = reason;
        log.warn(reason);
    }
    return reason;
}
