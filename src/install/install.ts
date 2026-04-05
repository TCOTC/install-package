import { getFrontend } from "siyuan";
import { i18n } from "../infra/i18n";
import {
    fetchSyncPost,
    getFile,
    removeFiles,
    removeDirectory,
    copyToInstallPath,
    pathExists,
    unzipFile,
    writeTempFile,
} from "../infra/kernelClient";
import type { Logger } from "../types";

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
 * 根据集市包目录内容识别集市包类型（根目录须包含一个元数据 json）
 */
export async function getPackageType(packagePath: string, log: Logger): Promise<string | null> {
    const response = await fetchSyncPost("/api/file/readDir", { path: packagePath });
    if (response.code !== 0 || !Array.isArray(response.data)) {
        log.warn(i18n.readDirFailed, response.msg);
        return null;
    }

    const foundTypes = response.data
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
 * 解压根目录下仅有一个子文件夹时，将该文件夹视为集市包根目录。
 * 内核 globalCopyFiles 以源路径最后一级为安装目录名，故当该文件夹名与 packageName 不一致时先重命名为 packageName。
 */
async function resolveUnwrappedExtractRoot(
    outerExtractPath: string,
    packageName: string,
    log: Logger
): Promise<string | null> {
    const response = await fetchSyncPost("/api/file/readDir", { path: outerExtractPath });
    if (response.code !== 0 || !Array.isArray(response.data)) {
        log.warn(i18n.readDirFailed, response.msg);
        return null;
    }
    if (response.data.length !== 1) {
        return outerExtractPath;
    }
    const only = response.data[0] as { isDir?: boolean; name?: string };
    if (!only.isDir || typeof only.name !== "string") {
        return outerExtractPath;
    }
    const innerPath = `${outerExtractPath}/${only.name}`;
    if (only.name === packageName) {
        log.info(`检测到单一顶层文件夹，作为集市包根目录: ${innerPath}`);
        return innerPath;
    }
    const renamedPath = `${outerExtractPath}/${packageName}`;
    log.warn(`单一顶层目录名与包名不一致，重命名以匹配安装路径: ${innerPath} -> ${renamedPath}`);
    const renameRes = await fetchSyncPost("/api/file/renameFile", {
        path: innerPath,
        newPath: renamedPath,
    });
    if (renameRes.code !== 0) {
        log.warn(i18n.extractUnwrapRenameFailed, renameRes.msg);
        return null;
    }
    return renamedPath;
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
    if (modes.includes(window.siyuan.config.appearance.mode)) {
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
            const appearance = window.siyuan.config.appearance;
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
            const wasCurrentIcon = window.siyuan.config.appearance.icon === packageName;

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
        const pathsToClean = [tempPath, extractRootDir].filter(Boolean);
        if (pathsToClean.length > 0) {
            log.info(`Cleaning up temporary files: ${pathsToClean.join(", ")}`);
            await removeFiles(pathsToClean, log);
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

    if (!(await writeTempFile(blob, tempPath, log))) {
        return bail();
    }
    // 内核已落盘，去掉渲染进程侧对整包 ZIP 的引用（含调用方 downloadResult.blob）
    pack.blob = null;
    log.info(`Temporary file written successfully: ${tempPath}`);

    extractPath = `${extractRootDir}/${packageName}`;
    log.info(`Extracting to final directory: ${extractPath}`);
    if (!(await unzipFile(tempPath, extractPath, log))) {
        return bail();
    }
    log.info(`Extraction completed: ${extractPath}`);

    const resolvedRoot = await resolveUnwrappedExtractRoot(extractPath, packageName, log);
    if (resolvedRoot === null) {
        return bail();
    }
    extractPath = resolvedRoot;

    const packageType = await getPackageType(extractPath, log);
    if (!packageType) {
        return bail();
    }
    log.info(`Package type detected: ${packageType}`);

    const extractDirData = await fetchSyncPost("/api/file/readDir", { path: extractPath });
    log.info("Extracted directory contents:", extractDirData);

    const metadataPackageName = await getPackageName(extractPath, packageType, log);
    if (!metadataPackageName) {
        return bail();
    }
    log.info(`Package name from metadata: ${metadataPackageName}, repository name: ${packageName}`);

    if (metadataPackageName !== packageName) {
        log.warn(i18n.packageNameMismatch
            .replace("{metadataName}", metadataPackageName)
            .replace("{repoName}", packageName),
        );
        return bail();
    }

    log.info("Package name verification passed");

    const installPath = `${getInstallPath(packageType)}/${packageName}`;
    log.info(`Final package name: ${packageName}`);
    log.info(`Target installation path: ${installPath}`);

    if (await pathExists(installPath)) {
        log.info(`Target directory already exists: ${installPath}`);
        log.info(i18n.targetDirExists.replace("{path}", installPath));

        if (!(await removeDirectory(installPath, log))) {
            return bail();
        }
        log.info(`Cleared old package files: ${installPath}`);
    } else {
        log.info(`Target directory does not exist: ${installPath}`);
    }

    log.info(`Starting to copy files from ${extractPath} to ${installPath}`);
    if (!(await copyToInstallPath(extractPath, installPath, log))) {
        return bail();
    }
    log.info(`File copy completed: ${installPath}`);

    const installDirData = await fetchSyncPost("/api/file/readDir", { path: installPath });
    log.info("Post-installation directory contents:", installDirData);

    log.info(`Package installed successfully: ${packageName}`);
    return succeed(packageType, packageName);
}
