import { getFrontend } from "siyuan";
import { i18n } from "./i18n";
import { message } from "./message";
import {
    fetchSyncPost,
    getFile,
    removeFiles,
    clearDirectory,
    copyToInstallPath,
    pathExists,
    unzipFile,
    writeTempFile,
} from "./kernelClient";
import type { Logger } from "./panel";

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
            return "data/plugins";
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
export async function getPackageType(packagePath: string): Promise<string | null> {
    const response = await fetchSyncPost("/api/file/readDir", { path: packagePath });
    if (response.code !== 0 || !Array.isArray(response.data)) {
        message(i18n.readDirFailed.replace("{error}", response.msg));
        return null;
    }

    const foundTypes = response.data
        .filter((item) => !item.isDir && typeof item.name === "string" && METADATA_JSON_FILES.includes(item.name))
        .map((item) => item.name.slice(0, -5));

    if (foundTypes.length === 0) {
        message(i18n.noMetadataFiles);
        return null;
    }
    if (foundTypes.length > 1) {
        message(i18n.multipleMetadataFiles.replace("{files}", foundTypes.join(", ")));
        return null;
    }
    return foundTypes[0];
}

export async function getPackageName(extractPath: string, packageType: string, log: Logger): Promise<string | null> {
    log(`Extracting package name from metadata: ${extractPath}, type: ${packageType}`);

    const metadataPath = `${extractPath}/${packageType}.json`;
    log(`Reading package metadata file: ${metadataPath}`);
    const fileResult = await getFile(metadataPath);
    if (fileResult.ok === false) {
        message(i18n.getPackageNameError.replace("{error}", fileResult.msg || `code ${fileResult.code}`,));
        return null;
    }
    let packageMetadata: Record<string, unknown>;
    try {
        packageMetadata = JSON.parse(fileResult.content);
    } catch {
        message(i18n.getPackageNameError.replace("{error}", i18n.metadataFileInvalidJson));
        return null;
    }
    log("Package metadata:", packageMetadata);

    const packageName = (packageMetadata.name ?? packageMetadata.packageName) as string | undefined;

    if (!packageName) {
        message(i18n.packageNameNotFoundInMetadata);
        return null;
    }

    log(`Package name extracted from metadata: ${packageName}`);

    if (typeof packageName !== "string" || packageName.trim() === "") {
        message(i18n.invalidPackageName.replace("{name}", String(packageName)));
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
    enabled: boolean,
    log: Logger
): Promise<void> {
    switch (packageType) {
        case "plugin": {
            const action = enabled ? "enable" : "disable";
            log(`Attempting to ${action} plugin: ${packageName}`);
            const response = await fetchSyncPost("/api/petal/setPetalEnabled", {
                packageName: packageName,
                enabled: enabled,
                frontend: getFrontend(),
            });
            if (response.code === 0) {
                log(`Plugin ${packageName} ${action}d successfully`);
                return;
            }
            log(`Failed to ${action} plugin: ${response.msg}`);
            const tpl = enabled ? i18n.enablePluginFailed : i18n.disablePluginFailed;
            message(tpl.replace("{error}", String(response.msg ?? "")));
        }
        case "theme": {
            const response = await fetchSyncPost("/api/ui/reloadTheme", {});
            if (response.code !== 0) {
                log(`reloadTheme before setTheme failed: ${response.msg}`);
                message(i18n.themeReloadFailed);
                return;
            }
            if (enabled) {
                const modes = await getSetThemeModes(packageName);
                const appearanceMode = getSwitchAppearanceMode(modes);
                log(`Applying theme [${packageName}], modes=[${modes.join(",")}], appearanceMode=[${appearanceMode}]`);
                const response = await fetchSyncPost("/api/setting/setTheme", {
                    theme: packageName,
                    modes,
                    appearanceMode, // 值为空字符串时不影响内核处理
                });
                if (response.code === 0) {
                    log(`Theme ${packageName} applied successfully`);
                    return;
                }
                log(`Failed to apply theme: ${response.msg}`);
                message(i18n.enablePackageFailed.replace("{error}", String(response.msg ?? "")));
                return;
            }
            // TODO 如果禁用主题，需要将正在使用该主题的外观模式切换回默认主题（在调用 reloadTheme 之前获取当前的主题和外观模式，就知道了）
            log(`Theme ${packageName} installed (not switching)`);
        }
        case "icon": {
            const response = await fetchSyncPost("/api/ui/reloadIcon", {});
            if (response.code !== 0) {
                log(`reloadIcon before setAppearance failed: ${response.msg}`);
                message(i18n.iconReloadFailed);
                return;
            }
            if (enabled) {
                // TODO 这个接口在 v3.6.2 才支持，要修改 plugin.json 的 minAppVersion 为 3.6.2
                const response = await fetchSyncPost("/api/setting/setIcon", { icon: packageName });
                if (response.code === 0) {
                    log(`Icon ${packageName} applied successfully`);
                    return;
                }
                log(`Failed to apply icon: ${response.msg}`);
                message(i18n.enablePackageFailed.replace("{error}", String(response.msg ?? "")));
                return;
            }
            // TODO 如果当前正在使用该图标，需要将图标切换回默认图标（在调用 reloadIcon 之前获取当前的图标，就知道了）
            log(`Icon ${packageName} installed (not switching)`);
            return;
        }
        default: {
            log(`${packageType} ${packageName} installed`);
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
        message(i18n.packageInstallFailed);
        return null;
    }
    let tempPath = "";
    let extractPath = "";

    const runCleanup = async () => {
        const extractBaseDir = extractPath ? extractPath.substring(0, extractPath.lastIndexOf("/")) : "";
        const pathsToClean = [tempPath, extractBaseDir].filter(Boolean);
        if (pathsToClean.length > 0) {
            log(`Cleaning up temporary files: ${pathsToClean.join(", ")}`);
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

    log(`Starting package installation: ${fileName}, name: ${packageName}`);

    const tempId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const tempFileName = `temp_${tempId}_${fileName}`;
    tempPath = `temp/export/${tempFileName}`;
    log(`Creating temporary file: ${tempPath}`);

    if (!(await writeTempFile(blob, tempPath, log))) {
        return bail();
    }
    // 内核已落盘，去掉渲染进程侧对整包 ZIP 的引用（含调用方 downloadResult.blob）
    pack.blob = null;
    log(`Temporary file written successfully: ${tempPath}`);

    extractPath = `temp/export/extract_${tempId}/${packageName}`;
    log(`Extracting to final directory: ${extractPath}`);
    if (!(await unzipFile(tempPath, extractPath, log))) {
        return bail();
    }
    log(`Extraction completed: ${extractPath}`);

    const packageType = await getPackageType(extractPath);
    if (!packageType) {
        return bail();
    }
    log(`Package type detected: ${packageType}`);

    const extractDirData = await fetchSyncPost("/api/file/readDir", { path: extractPath });
    log("Extracted directory contents:", extractDirData);

    const metadataPackageName = await getPackageName(extractPath, packageType, log);
    if (!metadataPackageName) {
        return bail();
    }
    log(`Package name from metadata: ${metadataPackageName}, repository name: ${packageName}`);

    if (metadataPackageName !== packageName) {
        const errorMsg = `Package name mismatch: metadata ${metadataPackageName}, repo ${packageName}`;
        log(errorMsg);
        message(i18n.packageNameMismatch
            .replace("{metadataName}", metadataPackageName)
            .replace("{repoName}", packageName)
        );
        return bail();
    }

    log("Package name verification passed");

    const installPath = `${getInstallPath(packageType)}/${packageName}`;
    log(`Final package name: ${packageName}`);
    log(`Target installation path: ${installPath}`);

    if (await pathExists(installPath)) {
        log(`Target directory already exists: ${installPath}`);
        message(i18n.targetDirExists.replace("{path}", installPath), true);

        if (!(await clearDirectory(installPath, log))) {
            return bail();
        }
        log(`Cleared old package files: ${installPath}`);
    } else {
        log(`Target directory does not exist: ${installPath}`);
    }

    log(`Starting to copy files from ${extractPath} to ${installPath}`);
    if (!(await copyToInstallPath(extractPath, installPath, log))) {
        return bail();
    }
    log(`File copy completed: ${installPath}`);

    const installDirData = await fetchSyncPost("/api/file/readDir", { path: installPath });
    log("Post-installation directory contents:", installDirData);

    log(`Package installed successfully: ${packageName}`);
    return succeed(packageType, packageName);
}
