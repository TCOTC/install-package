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

export function getInstallPath(packageType: string): string {
    switch (packageType) {
        case "plugin":
            return "data/plugins";
        case "widget":
            return "data/widgets";
        case "template":
            return "data/templates";
        case "theme":
            return "conf/appearance/themes";
        case "icon":
            return "conf/appearance/icons";
        default:
            throw new Error(`Unknown package type: ${packageType}`);
    }
}

const METADATA_JSON_FILES = [
    "plugin.json",
    "widget.json",
    "template.json",
    "theme.json",
    "icon.json",
];

/**
 * 根据已列举的目录项识别集市包类型（根目录须包含一个元数据 json）
 */
function getPackageType(entries: ReadDirEntry[], log: Logger): string | null {
    const foundTypes = entries
        .filter((item) => !item.isDir && typeof item.name === "string" && METADATA_JSON_FILES.includes(item.name))
        .map((item) => item.name.slice(0, -5));

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
 * 否则沿用当前路径。子文件夹名须与 `packageName` 一致以便 `globalCopyFiles` 安装目录名正确，不一致时先重命名。
 * 最终路径与首次列举路径相同时复用第一次 readDir 结果，避免重复请求。
 */
async function resolveExtractRoot(
    outerExtractPath: string,
    packageName: string,
    log: Logger
): Promise<{ path: string; entries: ReadDirEntry[] } | null> {
    const outerEntries = await readDir(outerExtractPath, log);
    if (!outerEntries) {
        return null;
    }

    let finalPath = outerExtractPath;

    const only = outerEntries[0];
    if (outerEntries.length === 1 && only.isDir && typeof only.name === "string") {
        const innerPath = `${outerExtractPath}/${only.name}`;
        if (only.name === packageName) {
            log.info(`Detected a single top-level directory, using as marketplace package root: ${innerPath}`);
            finalPath = innerPath;
        } else {
            const renamedPath = `${outerExtractPath}/${packageName}`;
            log.warn(`The single top-level directory name does not match the package name. Renaming to match installation path: ${innerPath} -> ${renamedPath}`);
            if (!(await renameFile(innerPath, renamedPath, log))) {
                return null;
            }
            finalPath = renamedPath;
        }
    }

    const entries =
        finalPath === outerExtractPath
            ? outerEntries
            : await readDir(finalPath, log);
    if (!entries) {
        return null;
    }
    return { path: finalPath, entries };
}

export async function getPackageName(extractPath: string, packageType: string, log: Logger): Promise<string | null> {
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
    packageType: string,
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
                    const resetIcon = await fetchSyncPost("/api/setting/setIcon", { icon: "material" });
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
    packageName: string;
}, log: Logger): Promise<{
    packageType: string;
    packageName: string
} | null> {
    const { blob, fileName, packageName } = pack;
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

    const succeed = async (packageType: string, pkgName: string) => {
        await runCleanup();
        return { packageType, packageName: pkgName };
    };

    log.info(`Starting package installation: ${fileName}, name: ${packageName}`);

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

    extractPath = `${extractRootDir}/${packageName}`;
    log.info(`Extracting to final directory: ${extractPath}`);
    if (!(await unzipFile(tempPath, extractPath, log))) {
        return bail();
    }
    log.info(`Extraction completed: ${extractPath}`);

    const extractRootResult = await resolveExtractRoot(extractPath, packageName, log);
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
    log.info(`Package name from metadata: ${metadataPackageName}, repository name: ${packageName}`);

    const installPackageName = metadataPackageName;

    if (metadataPackageName !== packageName) {
        log.warn(i18n.packageNameMismatch
            .replace("{metadataName}", metadataPackageName)
            .replace("{repoName}", packageName),
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
        if (await pathExists(renamedExtractPath)) {
            log.warn(`Cannot rename extract directory: target already exists [${renamedExtractPath}]`);
            return bail();
        }
        log.info(`Renaming extract directory to metadata package name: ${extractPath} -> ${renamedExtractPath}`);
        if (!(await renameFile(extractPath, renamedExtractPath, log))) {
            return bail();
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
