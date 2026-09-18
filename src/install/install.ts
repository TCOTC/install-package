import { getFrontend } from "siyuan";
import { i18n } from "../infra/i18n";
import {
    fetchSyncPost,
    getFile,
    putFile,
    removeFile,
    workspaceCopyFiles,
    pathExists,
    readDir,
    renameFile,
    type ReadDirEntry,
    unzipFile,
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

/**
 * 元数据文件名（`plugin.json`）转换为集市包类型（`plugin`）
 *
 * 包类型只能由 `INSTALL_PATHS` 的自有键推导出来，非元数据文件名返回 null；
 * 用 `hasOwnProperty` 而非 `in`，避免 `constructor.json` 这类名字命中原型链上的属性
 */
function toPackageType(fileName: string): PackageType | null {
    const packageType = fileName.endsWith(".json") ? fileName.slice(0, -5) : "";
    return Object.prototype.hasOwnProperty.call(INSTALL_PATHS, packageType) ? packageType as PackageType : null;
}

export function getInstallPath(packageType: PackageType): string {
    return INSTALL_PATHS[packageType];
}

/**
 * 解压临时目录名：刻意与仓库名/元数据包名都不相关。
 * 若直接把仓库名当解压目录名，遇到「仓库名与元数据包名仅差大小写」的包（如 Aptlantis-Assembly /
 * aptlantis-assembly）时，在大小写不敏感的文件系统上目标目录会被判定为已存在而导致改名失败。
 */
const EXTRACT_STAGING_DIR = "pkg";

/**
 * 根据已列举的目录项识别集市包类型（根目录须包含一个元数据 json）
 */
function getPackageType(entries: ReadDirEntry[], log: Logger): PackageType | null {
    const foundTypes = entries
        .filter((item) => !item.isDir && typeof item.name === "string")
        .map((item) => toPackageType(item.name))
        .filter((packageType): packageType is PackageType => packageType !== null);

    if (foundTypes.length === 0) {
        log.warn(i18n.noMetadataFiles);
        return null;
    }
    if (foundTypes.length > 1) {
        log.warn(i18n.multipleMetadataFiles.replace("{files}", foundTypes.join(", ")));
        return null;
    }
    return foundTypes[0];
}

/**
 * 解析解压后的集市包根路径并列举其内容：若目录内仅有单个子文件夹，则视其为包根（与 GitHub Release 常见「多包一层」结构一致）；
 * 否则沿用当前路径。
 *
 * 此处不做任何重命名 —— 目录名与仓库名无关，最终一律改名为元数据包名（见 `installPackage`）。
 * 最终路径与首次列举路径相同时复用第一次 readDir 结果，避免重复请求。
 */
async function resolveExtractRoot(
    outerExtractPath: string,
    log: Logger
): Promise<{ path: string; entries: ReadDirEntry[] } | null> {
    const outerEntries = await readDir(outerExtractPath, log);
    if (!outerEntries) {
        return null;
    }

    const only = outerEntries[0];
    if (outerEntries.length === 1 && only.isDir && typeof only.name === "string") {
        const innerPath = `${outerExtractPath}/${only.name}`;
        log.info(`Detected a single top-level directory, using as marketplace package root: ${innerPath}`);
        const entries = await readDir(innerPath, log);
        if (!entries) {
            return null;
        }
        return { path: innerPath, entries };
    }

    return { path: outerExtractPath, entries: outerEntries };
}

export async function getPackageName(extractPath: string, packageType: PackageType, log: Logger): Promise<string | null> {
    log.info(`Extracting package name from metadata: ${extractPath}, type: ${packageType}`);

    const metadataPath = `${extractPath}/${packageType}.json`;
    log.info(`Reading package metadata file: ${metadataPath}`);
    const fileResult = await getFile(metadataPath);
    if (fileResult.ok === false) {
        log.warn(i18n.getPackageNameError, fileResult.msg || `code ${fileResult.code}`);
        return null;
    }
    let packageMetadata: Record<string, unknown>;
    try {
        packageMetadata = JSON.parse(fileResult.content);
    } catch {
        log.warn(i18n.getPackageNameError, i18n.metadataFileInvalidJson);
        return null;
    }
    log.info("Package metadata:", packageMetadata);

    const packageName = (packageMetadata.name ?? packageMetadata.packageName) as string | undefined;

    if (!packageName) {
        log.warn(i18n.packageNameNotFoundInMetadata);
        return null;
    }

    log.info(`Package name extracted from metadata: ${packageName}`);

    if (typeof packageName !== "string" || packageName.trim() === "") {
        log.warn(i18n.invalidPackageName, String(packageName));
        return null;
    }

    return packageName.trim();
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

export async function setPackageEnabled(
    packageType: PackageType,
    packageName: string,
    enableAfterInstall: boolean,
    log: Logger
): Promise<void> {
    switch (packageType) {
        case "plugin": {
            const action = enableAfterInstall ? "enable" : "disable";
            log.info(`Attempting to ${action} plugin: ${packageName}`);
            const response = await fetchSyncPost("/api/petal/setPetalEnabled", {
                packageName: packageName,
                enabled: enableAfterInstall,
                frontend: getFrontend(),
            });
            if (response.code === 0) {
                log.info(`Plugin ${packageName} ${action}d successfully`);
                return;
            }
            log.warn(enableAfterInstall ? i18n.enablePluginFailed : i18n.disablePluginFailed, response.msg);
            break;
        }
        case "theme": {
            const config = window.siyuan.config;
            if (!config) {
                log.warn(i18n.enablePackageFailed, "siyuan config unavailable");
                return;
            }
            const appearance = config.appearance;
            const wasLightTheme = appearance.themeLight === packageName;
            const wasDarkTheme = appearance.themeDark === packageName;

            const response = await fetchSyncPost("/api/ui/reloadTheme", {});
            if (response.code !== 0) {
                log.warn(i18n.themeReloadFailed, response.msg);
                return;
            }
            if (enableAfterInstall) {
                // TODO 看看能不能复用前面获取的 JSON 对象（另外前面必须要 parse JSON 不报错以验证元数据文件是否合法）
                const modes = await getSetThemeModes(packageName);
                const appearanceMode = getSwitchAppearanceMode(modes);
                log.info(`Applying theme [${packageName}], modes=[${modes.join(",")}], appearanceMode=[${appearanceMode}]`);
                const response = await fetchSyncPost("/api/setting/setTheme", {
                    theme: packageName,
                    modes,
                    appearanceMode, // 值为空字符串时不影响内核处理
                });
                if (response.code === 0) {
                    log.info(`Theme ${packageName} applied successfully`);
                    return;
                }
                log.warn(i18n.enablePackageFailed, response.msg);
                return;
            } else {
                // 禁用时重置为默认主题
                if (wasLightTheme) {
                    const resetLight = await fetchSyncPost("/api/setting/setTheme", {
                        theme: "daylight",
                        modes: [0],
                    });
                    if (resetLight.code !== 0) {
                        log.warn(`Failed to reset light theme to default: ${resetLight.msg}`);
                        return;
                    }
                }
                if (wasDarkTheme) {
                    const resetDark = await fetchSyncPost("/api/setting/setTheme", {
                        theme: "midnight",
                        modes: [1],
                    });
                    if (resetDark.code !== 0) {
                        log.warn(`Failed to reset dark theme to default: ${resetDark.msg}`);
                        return;
                    }
                }
            }
            log.info(`Theme ${packageName} installed (not switching)`);
            break;
        }
        case "icon": {
            const config = window.siyuan.config;
            if (!config) {
                log.warn(i18n.enablePackageFailed, "siyuan config unavailable");
                return;
            }
            const wasCurrentIcon = config.appearance.icon === packageName;

            const response = await fetchSyncPost("/api/ui/reloadIcon", {});
            if (response.code !== 0) {
                log.warn(i18n.iconReloadFailed, response.msg);
                return;
            }
            if (enableAfterInstall) {
                const response = await fetchSyncPost("/api/setting/setIcon", { icon: packageName });
                if (response.code === 0) {
                    log.info(`Icon ${packageName} applied successfully`);
                    return;
                }
                log.warn(i18n.enablePackageFailed, response.msg);
                return;
            } else {
                // 禁用时重置为默认图标
                if (wasCurrentIcon) {
                    const resetIcon = await fetchSyncPost("/api/setting/setIcon", { icon: "litheness" });
                    if (resetIcon.code !== 0) {
                        log.warn(`Failed to reset icon to default: ${resetIcon.msg}`);
                        return;
                    }
                }
            }
            log.info(`Icon ${packageName} installed (not switching)`);
            break;
        }
        default: {
            log.info(`${packageType} ${packageName} installed`);
            break;
        }
    }
}

/** 与 downloadPackage 成功结果同构；写入临时文件成功后会把 blob 置为 null，便于尽早释放 ZIP 内存 */
export async function installPackage(pack: {
    blob: Blob | null;
    fileName: string;
    repoPackageName: string;
}, log: Logger): Promise<{
    packageType: PackageType;
    packageName: string
} | null> {
    const { blob, fileName, repoPackageName } = pack;
    if (!blob) {
        log.warn(i18n.packageInstallFailed);
        return null;
    }
    let tempPath = "";
    let extractPath = "";

    const tempId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const extractRootDir = `temp/export/extract_${tempId}`;

    const runCleanup = async () => {
        const pathsToClean = [tempPath, extractRootDir].filter(
            (p) => typeof p === "string" && p.trim().length > 0
        );
        if (pathsToClean.length > 0) {
            log.info("Cleaning up temporary files");
            for (const p of pathsToClean) {
                await removeFile(p, log);
            }
        }
    };

    const bail = async (): Promise<null> => {
        await runCleanup();
        return null;
    };

    const succeed = async (packageType: PackageType, pkgName: string) => {
        await runCleanup();
        return { packageType, packageName: pkgName };
    };

    log.info(`Starting package installation: ${fileName}, repository name: ${repoPackageName}`);

    const tempFileName = `temp_${tempId}_${fileName}`;
    tempPath = `temp/export/${tempFileName}`;
    log.info(`Creating temporary file: ${tempPath}`);
    log.info(`Writing temporary file: ${tempPath}, data size: ${blob.size} bytes`);
    const putResult = await putFile({ path: tempPath, isDir: false, file: blob });
    if (putResult.code !== 0) {
        log.warn(`Failed to write temporary file [${tempPath}]: code=[${putResult.code}], msg=[${putResult.msg}]`);
        return bail();
    }
    log.info(`Temporary file written successfully: ${tempPath}`);
    // 内核已落盘，去掉渲染进程侧对整包 ZIP 的引用（含调用方 downloadResult.blob）
    pack.blob = null;

    // 解压目录使用与仓库名无关的中性名：仓库名可能与元数据包名仅差大小写（如 Aptlantis-Assembly /
    // aptlantis-assembly），在大小写不敏感的文件系统上会与后面「改名为元数据包名」这一步自相冲突
    extractPath = `${extractRootDir}/${EXTRACT_STAGING_DIR}`;
    log.info(`Extracting to final directory: ${extractPath}`);
    if (!(await unzipFile(tempPath, extractPath, log))) {
        return bail();
    }
    log.info(`Extraction completed: ${extractPath}`);

    const extractRootResult = await resolveExtractRoot(extractPath, log);
    if (extractRootResult === null) {
        return bail();
    }
    extractPath = extractRootResult.path;
    const extractEntries = extractRootResult.entries;

    const packageType = getPackageType(extractEntries, log);
    if (!packageType) {
        return bail();
    }
    log.info(`Package type detected: ${packageType}`);

    log.info("Extracted directory contents:", extractEntries);

    const metadataPackageName = await getPackageName(extractPath, packageType, log);
    if (!metadataPackageName) {
        return bail();
    }
    log.info(`Package name from metadata: ${metadataPackageName}, repository name: ${repoPackageName}`);

    // 安装目录名一律以元数据包名为准，仓库名不参与任何路径计算
    const installPackageName = metadataPackageName;

    if (metadataPackageName !== repoPackageName) {
        log.warn(i18n.packageNameMismatch
            .replace("{metadataName}", metadataPackageName)
            .replace("{repoName}", repoPackageName),
        );
    }

    // workspaceCopyFiles 以源路径最后一级为子目录名落盘，须与元数据包名一致
    const lastSlash = extractPath.lastIndexOf("/");
    const extractParent = lastSlash >= 0 ? extractPath.slice(0, lastSlash) : "";
    const extractBasename = lastSlash >= 0 ? extractPath.slice(lastSlash + 1) : extractPath;
    if (extractBasename !== installPackageName) {
        if (!extractParent) {
            log.warn("Cannot rename extract root: missing parent path");
            return bail();
        }
        const renamedExtractPath = `${extractParent}/${installPackageName}`;
        // 兜底：若压缩包内层目录名与元数据包名仅差大小写（如 aptlantis-assembly / Aptlantis-Assembly），
        // 在大小写不敏感的文件系统（Windows / macOS）上目标会被判定为「已存在」，但其实是同一个目录，并非命名冲突
        const caseOnlyRename = extractBasename.toLowerCase() === installPackageName.toLowerCase();
        if (!caseOnlyRename && await pathExists(renamedExtractPath)) {
            log.warn(`Cannot rename extract directory: target already exists [${renamedExtractPath}]`);
            return bail();
        }
        if (caseOnlyRename) {
            // 大小写不敏感的文件系统上直接改名到目标名不会真正改变大小写，且内核 renameFile 会因
            // 「目标已存在」返回 409，因此先改到中间名再改到目标名
            const stagingExtractPath = `${extractParent}/staging_${tempId}`;
            log.info(`Renaming extract directory to metadata package name (case-only, via staging path): ${extractPath} -> ${stagingExtractPath} -> ${renamedExtractPath}`);
            if (!(await renameFile(extractPath, stagingExtractPath, log))) {
                return bail();
            }
            if (!(await renameFile(stagingExtractPath, renamedExtractPath, log))) {
                return bail();
            }
        } else {
            log.info(`Renaming extract directory to metadata package name: ${extractPath} -> ${renamedExtractPath}`);
            if (!(await renameFile(extractPath, renamedExtractPath, log))) {
                return bail();
            }
        }
        extractPath = renamedExtractPath;
    }

    const installPath = `${getInstallPath(packageType)}/${installPackageName}`;
    log.info(`Final package name: ${installPackageName}`);
    log.info(`Target installation path: ${installPath}`);

    if (await pathExists(installPath)) {
        log.info(`Target directory already exists: ${installPath}`);
        log.info(i18n.targetDirExists.replace("{path}", installPath));

        if (!(await removeFile(installPath, log))) {
            return bail();
        }
        log.info(`Cleared old package files: ${installPath}`);
    } else {
        log.info(`Target directory does not exist: ${installPath}`);
    }

    const installDestDir = getInstallPath(packageType);
    log.info(`Starting to copy files from ${extractPath} to ${installDestDir}`);
    if (!(await workspaceCopyFiles(extractPath, installDestDir, log))) {
        return bail();
    }
    log.info(`File copy completed: ${installPath}`);

    log.info(`Package installed successfully: ${installPackageName}`);
    return succeed(packageType, installPackageName);
}
