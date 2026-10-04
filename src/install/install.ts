import { Constants, getFrontend } from "siyuan";
import { i18n } from "../infra/i18n";
import {
    fetchSyncPost,
    getFile,
    getFileBlob,
    installLocalBazaarPackage,
    putFile,
    readDir,
    removeFile,
    unzipFile,
    zipFile,
    type KernelApiResponse,
} from "../infra/kernelClient";
import type { Logger } from "../ui/logger";

/**
 * 各类型集市包在工作空间内的安装目录
 *
 * 主题和图标自思源 v3.8.5 起存放在 data 目录，内核按整包读写并维护安装状态
 */
const INSTALL_PATHS = {
    plugin: "data/plugins",
    widget: "data/widgets",
    template: "data/templates",
    theme: "data/themes",
    icon: "data/icons",
} as const;

export type PackageType = keyof typeof INSTALL_PATHS;

/** 内核集市接口使用的包类型名（复数形式）与本插件包类型的映射 */
export const PACKAGE_TYPE_BY_KERNEL_TYPE: Record<string, PackageType | undefined> = {
    plugins: "plugin",
    widgets: "widget",
    templates: "template",
    themes: "theme",
    icons: "icon",
};

/** 元数据文件名，内核按该文件名识别集市包类型 */
const MANIFEST_FILES: Record<PackageType, string> = {
    plugin: "plugin.json",
    widget: "widget.json",
    template: "template.json",
    theme: "theme.json",
    icon: "icon.json",
};

export function getInstallPath(packageType: PackageType): string {
    return INSTALL_PATHS[packageType];
}

/** `/api/bazaar/installLocalBazaarPackage` 成功时的返回数据 */
interface LocalInstallData {
    packageType: PackageType;
    packageName: string;
}

/** `/api/bazaar/installLocalBazaarPackage` 失败时内核附带的数据 */
interface LocalInstallFailure {
    reason: string;
    packageType?: PackageType;
    packageName: string;
    minAppVersion: string;
}

type LocalInstallResult =
    | { ok: true; data: LocalInstallData }
    | { ok: false; msg: string; failure?: LocalInstallFailure; transportFailed?: boolean };

/**
 * 内核安装接口的传输失败重试间隔
 *
 * 包已下载完成、Blob 就在内存里，此时因网络或代理瞬时故障失败时，重传的代价远低于让用户重下整个包；
 * 因此只对「请求未到达内核」的情况重试，内核返回的业务错误（不兼容、已存在等）重试也没有意义。
 * 间隔逐次拉长是为了给「恢复网络或切回代理」留出时间，合计约 10 秒
 */
const INSTALL_RETRY_DELAYS_MS = [1000, 3000, 6000];

/**
 * 解析内核本地安装接口的返回
 *
 * 失败时保留内核给出的原因与元数据，供调用方判断是否需要改写 minAppVersion 后重试
 */
function parseLocalInstallResponse(response: KernelApiResponse): LocalInstallResult {
    const data = (response.data ?? {}) as Record<string, unknown>;
    const kernelType = typeof data.packageType === "string" ? data.packageType : "";
    if (response.code === 0) {
        const packageName = typeof data.packageName === "string" ? data.packageName : "";
        const packageType = PACKAGE_TYPE_BY_KERNEL_TYPE[kernelType];
        if (!packageType || packageName === "") {
            return { ok: false, msg: i18n.packageInstallResponseError };
        }
        return { ok: true, data: { packageType, packageName } };
    }
    return {
        ok: false,
        msg: response.msg,
        transportFailed: response.transportFailed === true,
        failure: {
            reason: typeof data.reason === "string" ? data.reason : "",
            packageType: PACKAGE_TYPE_BY_KERNEL_TYPE[kernelType],
            packageName: typeof data.packageName === "string" ? data.packageName : "",
            minAppVersion: typeof data.minAppVersion === "string" ? data.minAppVersion : "",
        },
    };
}

/** 等待指定毫秒，用于重试之间的退避 */
function delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * 把 ZIP 交给内核安装
 *
 * 仅对「请求未到达内核」的传输失败按固定间隔重试，其余失败直接返回
 */
async function uploadLocalPackage(blob: Blob, fileName: string, log: Logger): Promise<LocalInstallResult> {
    for (let attempt = 0; ; attempt++) {
        const response = await installLocalBazaarPackage(blob, fileName, getFrontend());
        const result = parseLocalInstallResponse(response);
        if (result.ok || response.transportFailed !== true || attempt >= INSTALL_RETRY_DELAYS_MS.length) {
            return result;
        }
        log.warn(i18n.installRetrying
            .replace("{attempt}", String(attempt + 1))
            .replace("{total}", String(INSTALL_RETRY_DELAYS_MS.length)),
        );
        await delay(INSTALL_RETRY_DELAYS_MS[attempt]);
    }
}

/**
 * 读取元数据文件
 *
 * 与内核识别集市包的规则一致：元数据位于压缩包根目录，或唯一的顶层目录内
 */
async function readManifest(extractPath: string, packageType: PackageType, log: Logger): Promise<{ path: string; content: string } | null> {
    const manifestFile = MANIFEST_FILES[packageType];
    let path = `${extractPath}/${manifestFile}`;
    let file = await getFile(path);
    if (file.ok) {
        return { path, content: file.content };
    }

    const entries = await readDir(extractPath, log);
    const onlyDir = entries?.length === 1 && entries[0].isDir ? entries[0].name : "";
    if (onlyDir === "") {
        return null;
    }
    path = `${extractPath}/${onlyDir}/${manifestFile}`;
    file = await getFile(path);
    return file.ok ? { path, content: file.content } : null;
}

/**
 * 根据已安装主题的 theme.json 得到主题支持的所有外观模式数组（0 明亮，1 暗黑）
 * 
 * 出错时返回 [0, 1]，最多只会有内核错误日志，行为不会发生异常
 */
async function getSetThemeModes(packageName: string): Promise<number[]> {
    const fileResult = await getFile(`${getInstallPath("theme")}/${packageName}/theme.json`);
    if (!fileResult.ok) {
        return [0, 1];
    }
    let parsed: { modes?: unknown };
    try {
        parsed = JSON.parse(fileResult.content) as { modes?: unknown };
    } catch {
        return [0, 1];
    }
    const modesRaw = parsed.modes;
    if (!Array.isArray(modesRaw)) {
        // 没有 modes 字段，视为支持所有外观模式
        return [0, 1];
    }
    const modes: number[] = [];
    if (modesRaw.includes("light")) {
        modes.push(0);
    }
    if (modesRaw.includes("dark")) {
        modes.push(1);
    }
    return modes;
}

/**
 * 根据主题支持的所有外观模式数组和当前外观模式，得到需要切换的外观模式，不需要切换时返回空字符串
 */
function getSwitchAppearanceMode(modes: number[]): string {
    const config = window.siyuan.config;
    if (!config) {
        return "";
    }
    if (modes.includes(config.appearance.mode)) {
        return "";
    }
    if (modes.includes(0)) {
        return "light";
    }
    if (modes.includes(1)) {
        return "dark";
    }
    return "";
}

/**
 * 按需启用或禁用集市包
 *
 * 「禁用」与「卸载」是两件事：禁用只是停用，卸载才会移除本地文件。
 * `enabled` 为真时启用，为假时禁用；安装流程只记录日志，列表菜单需要用返回值决定是否提示失败
 */
export async function setPackageEnabled(
    packageType: PackageType,
    packageName: string,
    enabled: boolean,
    log: Logger
): Promise<boolean> {
    switch (packageType) {
        case "plugin": {
            const action = enabled ? "enable" : "disable";
            const response = await fetchSyncPost("/api/petal/setPetalEnabled", {
                packageName: packageName,
                enabled: enabled,
                frontend: getFrontend(),
            });
            if (response.code === 0) {
                log.info(`Plugin ${packageName} ${action}d successfully`);
                return true;
            }
            log.warn(enabled ? i18n.enablePluginFailed : i18n.disablePluginFailed, response.msg);
            return false;
        }
        case "theme": {
            // 安装已由内核完成，内核会重载主题列表并推送外观刷新，此处只需按需切换为当前主题
            const config = window.siyuan.config;
            if (!config) {
                log.warn(i18n.enablePackageFailed, "siyuan config unavailable");
                return false;
            }
            const appearance = config.appearance;
            const wasLightTheme = appearance.themeLight === packageName;
            const wasDarkTheme = appearance.themeDark === packageName;

            if (enabled) {
                const modes = await getSetThemeModes(packageName);
                const appearanceMode = getSwitchAppearanceMode(modes);
                log.info(`Applying theme [${packageName}], modes=[${modes.join(",")}], appearanceMode=[${appearanceMode}]`);
                const response = await fetchSyncPost("/api/setting/setTheme", {
                    theme: packageName,
                    modes,
                    appearanceMode, // 值为空字符串时不影响内核处理
                });
                if (response.code === 0) {
                    return true;
                }
                log.warn(i18n.enablePackageFailed, response.msg);
                return false;
            } else {
                // 禁用时把主题重置为默认
                if (wasLightTheme) {
                    const resetLight = await fetchSyncPost("/api/setting/setTheme", {
                        theme: "daylight",
                        modes: [0],
                    });
                    if (resetLight.code !== 0) {
                        log.warn(`Failed to reset light theme to default: ${resetLight.msg}`);
                        return false;
                    }
                }
                if (wasDarkTheme) {
                    const resetDark = await fetchSyncPost("/api/setting/setTheme", {
                        theme: "midnight",
                        modes: [1],
                    });
                    if (resetDark.code !== 0) {
                        log.warn(`Failed to reset dark theme to default: ${resetDark.msg}`);
                        return false;
                    }
                }
            }
            return true;
        }
        case "icon": {
            // 安装已由内核完成，内核会重载图标列表并推送外观刷新，此处只需按需切换为当前图标
            const config = window.siyuan.config;
            if (!config) {
                log.warn(i18n.enablePackageFailed, "siyuan config unavailable");
                return false;
            }
            const wasCurrentIcon = config.appearance.icon === packageName;

            if (enabled) {
                const response = await fetchSyncPost("/api/setting/setIcon", { icon: packageName });
                if (response.code === 0) {
                    log.info(`Icon ${packageName} applied successfully`);
                    return true;
                }
                log.warn(i18n.enablePackageFailed, response.msg);
                return false;
            } else {
                // 禁用时把图标重置为默认
                if (wasCurrentIcon) {
                    const resetIcon = await fetchSyncPost("/api/setting/setIcon", { icon: "litheness" });
                    if (resetIcon.code !== 0) {
                        log.warn(`Failed to reset icon to default: ${resetIcon.msg}`);
                        return false;
                    }
                }
            }
            return true;
        }
        default: {
            // 挂件与模板没有启用状态，内核会在安装时落盘，这里无需诰诉用户“安装成功”
            return true;
        }
    }
}

/**
 * 把元数据中的 minAppVersion 改写为当前思源版本后重新安装
 *
 * 内核按集市包声明的 minAppVersion 校验兼容性，而审核中的集市包和 dev 版常常要求尚未发布的版本号，
 * 改写后即可安装，便于审核集市包与抢先体验 https://github.com/TCOTC/install-package/issues/32
 */
async function installWithCurrentMinAppVersion(pack: {
    blob: Blob | null;
    fileName: string;
}, failure: LocalInstallFailure, log: Logger): Promise<LocalInstallResult> {
    const { fileName, blob: sourceBlob } = pack;
    const packageType = failure.packageType;
    if (!sourceBlob || !packageType) {
        return { ok: false, msg: i18n.packageInstallResponseError };
    }

    const currentVersion = Constants.SIYUAN_VERSION;
    log.info(i18n.minAppVersionTooHigh
        .replace("{required}", failure.minAppVersion)
        .replace("{current}", currentVersion));

    const tempId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const tempPath = `temp/export/${tempId}_${fileName}`;
    const extractRootDir = `temp/export/extract_${tempId}`;
    const extractPath = `${extractRootDir}/pkg`;
    const repackedPath = `temp/export/${tempId}_patched.zip`;

    try {
        log.info(`Writing temporary file: ${tempPath}, data size: ${sourceBlob.size} bytes`);
        const putResult = await putFile({ path: tempPath, isDir: false, file: sourceBlob });
        if (putResult.code !== 0) {
            log.warn(`Failed to write temporary file [${tempPath}]: code=[${putResult.code}], msg=[${putResult.msg}]`);
            return { ok: false, msg: putResult.msg };
        }
        // 内核已落盘，去掉渲染进程侧对整包 ZIP 的引用（含调用方 downloadResult.blob）
        pack.blob = null;

        if (!(await unzipFile(tempPath, extractPath, log))) {
            return { ok: false, msg: "" };
        }
        const manifest = await readManifest(extractPath, packageType, log);
        if (!manifest) {
            log.warn(i18n.manifestReadFailed, MANIFEST_FILES[packageType]);
            return { ok: false, msg: "" };
        }
        let metadata: Record<string, unknown>;
        try {
            metadata = JSON.parse(manifest.content) as Record<string, unknown>;
        } catch {
            log.warn(i18n.metadataFileInvalidJson);
            return { ok: false, msg: "" };
        }
        metadata.minAppVersion = currentVersion;
        const writeResult = await putFile({
            path: manifest.path,
            isDir: false,
            file: new Blob([`${JSON.stringify(metadata, null, 2)}\n`], { type: "application/json" }),
        });
        if (writeResult.code !== 0) {
            log.warn(`Failed to write metadata [${manifest.path}]: code=[${writeResult.code}], msg=[${writeResult.msg}]`);
            return { ok: false, msg: writeResult.msg };
        }
        log.info(i18n.minAppVersionLowered
            .replace("{required}", failure.minAppVersion)
            .replace("{current}", currentVersion));

        // /api/archive/zip 会以目录名作为压缩包内的顶层目录，内核按「唯一顶层目录」规则识别元数据
        const manifestDir = manifest.path.slice(0, manifest.path.length - MANIFEST_FILES[packageType].length - 1);
        if (!(await zipFile(manifestDir, repackedPath, log))) {
            return { ok: false, msg: "" };
        }
        const repacked = await getFileBlob(repackedPath, log);
        if (!repacked) {
            return { ok: false, msg: "" };
        }
        return await uploadLocalPackage(repacked, fileName, log);
    } catch (error) {
        log.warn(i18n.installationFailed, error);
        return { ok: false, msg: "" };
    } finally {
        for (const path of [tempPath, extractRootDir, repackedPath]) {
            await removeFile(path, log);
        }
    }
}

/**
 * 安装集市包
 *
 * 落盘、覆盖旧包、失效缓存与集市状态推送均由内核完成，安装后集市列表会在各前端实例同步刷新
 */
export async function installPackage(pack: {
    blob: Blob | null;
    fileName: string;
    repoPackageName: string;
}, log: Logger): Promise<{
    packageType: PackageType;
    packageName: string
} | null> {
    const { fileName, repoPackageName } = pack;
    if (!pack.blob) {
        log.warn(i18n.packageInstallFailed);
        return null;
    }

    let result = await uploadLocalPackage(pack.blob, fileName, log);
    let loweredMinAppVersion = false;
    if (!result.ok && result.failure?.reason === "package-incompatible" && result.failure.minAppVersion !== "") {
        result = await installWithCurrentMinAppVersion(pack, result.failure, log);
        loweredMinAppVersion = true;
    }
    if (!result.ok) {
        // 传输失败与内核拒绝是两类问题，分别给出对应提示
        if (result.transportFailed) {
            log.warn(i18n.kernelConnectFailed);
        } else if (loweredMinAppVersion && result.failure?.reason === "package-incompatible") {
            // 改写 minAppVersion 后仍被拒绝，说明是包声明的前端或后端与当前环境不兼容
            log.warn(i18n.packageIncompatible, result.msg);
        } else {
            log.warn(i18n.installRequestFailed, result.msg);
        }
        return null;
    }

    const { packageType, packageName } = result.data;
    if (packageName !== repoPackageName) {
        log.warn(i18n.packageNameMismatch
            .replace("{metadataName}", packageName)
            .replace("{repoName}", repoPackageName),
        );
    }
    return { packageType, packageName };
}
