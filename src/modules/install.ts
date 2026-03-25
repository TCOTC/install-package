import { getFrontend } from "siyuan";
import { i18n } from "./i18n";
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

export type ExtractMetadataNameResult = { ok: true; name: string } | { ok: false; error: string };

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
export async function getPackageType(
    packagePath: string
): Promise<{ ok: true; packageType: string } | { ok: false; error: string }> {
    const response = await fetchSyncPost("/api/file/readDir", { path: packagePath });
    if (response.code !== 0 || !Array.isArray(response.data)) {
        return { ok: false, error: i18n.readDirFailed.replace("{error}", response.msg) };
    }

    const foundTypes = response.data
        .filter((item) => !item.isDir && typeof item.name === "string" && METADATA_JSON_FILES.includes(item.name))
        .map((item) => item.name.slice(0, -5));

    if (foundTypes.length === 0) {
        return { ok: false, error: i18n.noMetadataFiles };
    }
    if (foundTypes.length > 1) {
        return { ok: false, error: i18n.multipleMetadataFiles.replace("{files}", foundTypes.join(", ")) };
    }
    return { ok: true, packageType: foundTypes[0] };
}

export async function getPackageName(
    extractPath: string,
    packageType: string
): Promise<ExtractMetadataNameResult> {
    console.log(`Extracting package name from metadata: ${extractPath}, type: ${packageType}`);

    const metadataPath = `${extractPath}/${packageType}.json`;
    console.log(`Reading package metadata file: ${metadataPath}`);
    const fileResult = await getFile(metadataPath);
    if (fileResult.ok === false) {
        return {
            ok: false,
            error: i18n.getPackageNameError.replace(
                "{error}",
                fileResult.msg || `code ${fileResult.code}`,
            ),
        };
    }
    let packageMetadata: Record<string, unknown>;
    try {
        packageMetadata = JSON.parse(fileResult.content);
    } catch {
        return {
            ok: false,
            error: i18n.getPackageNameError.replace("{error}", i18n.metadataFileInvalidJson),
        };
    }
    console.log("Package metadata:", packageMetadata);

    const packageName = (packageMetadata.name ?? packageMetadata.packageName) as string | undefined;

    if (!packageName) {
        return { ok: false, error: i18n.packageNameNotFoundInMetadata };
    }

    console.log(`Package name extracted from metadata: ${packageName}`);

    if (typeof packageName !== "string" || packageName.trim() === "") {
        return { ok: false, error: i18n.invalidPackageName.replace("{name}", String(packageName)) };
    }

    return { ok: true, name: packageName.trim() };
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
    enabled: boolean
): Promise<string | undefined> {
    switch (packageType) {
        case "plugin": {
            const action = enabled ? "enable" : "disable";
            console.log(`Attempting to ${action} plugin: ${packageName}`);
            const response = await fetchSyncPost("/api/petal/setPetalEnabled", {
                packageName: packageName,
                enabled: enabled,
                frontend: getFrontend(),
            });
            if (response.code === 0) {
                console.log(`Plugin ${packageName} ${action}d successfully`);
                return undefined;
            }
            console.error(`Failed to ${action} plugin: ${response.msg}`);
            const tpl = enabled ? i18n.enablePluginFailed : i18n.disablePluginFailed;
            return tpl.replace("{error}", String(response.msg ?? ""));
        }
        case "theme": {
            const response = await fetchSyncPost("/api/ui/reloadTheme", {});
            if (response.code !== 0) {
                console.error(`reloadTheme before setTheme failed: ${response.msg}`);
                return i18n.themeReloadFailed;
            }
            if (enabled) {
                const modes = await getSetThemeModes(packageName);
                const appearanceMode = getSwitchAppearanceMode(modes);
                console.log(`Applying theme [${packageName}], modes=[${modes.join(",")}], appearanceMode=[${appearanceMode}]`);
                const response = await fetchSyncPost("/api/setting/setTheme", {
                    theme: packageName,
                    modes,
                    appearanceMode, // 值为空字符串时不影响内核处理
                });
                if (response.code === 0) {
                    console.log(`Theme ${packageName} applied successfully`);
                    return undefined;
                }
                console.error(`Failed to apply theme: ${response.msg}`);
                return i18n.enablePackageFailed.replace("{error}", String(response.msg ?? ""));
            } else {
                // TODO 如果禁用主题，需要将正在使用该主题的外观模式切换回默认主题（在调用 reloadTheme 之前获取当前的主题和外观模式，就知道了）
                console.log(`Theme ${packageName} installed (not switching)`);
                return undefined;
            }
        }
        case "icon": {
            const response = await fetchSyncPost("/api/ui/reloadIcon", {});
            if (response.code !== 0) {
                console.error(`reloadIcon before setAppearance failed: ${response.msg}`);
                return i18n.iconReloadFailed;
            }
            if (enabled) {
                // TODO 这个接口在 v3.6.2 才支持，要修改 plugin.json 的 minAppVersion 为 3.6.2
                const response = await fetchSyncPost("/api/setting/setIcon", { icon: packageName });
                if (response.code === 0) {
                    console.log(`Icon ${packageName} applied successfully`);
                    return undefined;
                }
                console.error(`Failed to apply icon: ${response.msg}`);
                return i18n.enablePackageFailed.replace("{error}", String(response.msg ?? ""));
            } else {
                // TODO 如果当前正在使用该图标，需要将图标切换回默认图标（在调用 reloadIcon 之前获取当前的图标，就知道了）
                console.log(`Icon ${packageName} installed (not switching)`);
                return undefined;
            }
        }
        default: {
            console.log(`${packageType} ${packageName} installed`);
            return undefined;
        }
    }
}

export type KernelInstallResult =
    | { ok: true; packageType: string; packageName: string; info?: string }
    | { ok: false; error: string };

export async function installPackage(
    data: Uint8Array,
    fileName: string,
    packageName: string
): Promise<KernelInstallResult> {
    let tempPath = "";
    let extractPath = "";

    const runCleanup = async () => {
        const extractBaseDir = extractPath ? extractPath.substring(0, extractPath.lastIndexOf("/")) : "";
        const pathsToClean = [tempPath, extractBaseDir].filter(Boolean);
        if (pathsToClean.length > 0) {
            console.log(`Cleaning up temporary files: ${pathsToClean.join(", ")}`);
            await removeFiles(pathsToClean);
        }
    };

    const fail = async (error: string): Promise<KernelInstallResult> => {
        await runCleanup();
        return { ok: false, error };
    };

    const succeed = async (packageType: string, pkgName: string, info?: string): Promise<KernelInstallResult> => {
        await runCleanup();
        return { ok: true, packageType, packageName: pkgName, info };
    };

    console.log(`Starting package installation: ${fileName}, name: ${packageName}`);

    const tempFileName = `temp_${Date.now()}_${fileName}`;
    tempPath = `temp/export/${tempFileName}`;
    console.log(`Creating temporary file: ${tempPath}`);

    const writeResult = await writeTempFile(data, tempPath);
    if (writeResult.ok === false) {
        return fail(writeResult.error);
    }
    console.log(`Temporary file written successfully: ${tempPath}`);

    extractPath = `temp/export/extract_${Date.now()}/${packageName}`;
    console.log(`Extracting to final directory: ${extractPath}`);
    const unzipResult = await unzipFile(tempPath, extractPath);
    if (unzipResult.ok === false) {
        return fail(unzipResult.error);
    }
    console.log(`Extraction completed: ${extractPath}`);

    const typeResult = await getPackageType(extractPath);
    if (typeResult.ok === false) {
        return fail(typeResult.error);
    }
    const packageType = typeResult.packageType;
    console.log(`Package type detected: ${packageType}`);

    const extractDirData = await fetchSyncPost("/api/file/readDir", { path: extractPath });
    console.log("Extracted directory contents:", extractDirData);

    const metadataResult = await getPackageName(extractPath, packageType);
    if (metadataResult.ok === false) {
        return fail(metadataResult.error);
    }
    const metadataPackageName = metadataResult.name;
    console.log(`Package name from metadata: ${metadataPackageName}, repository name: ${packageName}`);

    if (metadataPackageName !== packageName) {
        const errorMsg = `Package name mismatch: metadata ${metadataPackageName}, repo ${packageName}`;
        console.error(errorMsg);
        return fail(
            i18n.packageNameMismatch
                .replace("{metadataName}", metadataPackageName)
                .replace("{repoName}", packageName),
        );
    }

    console.log("Package name verification passed");

    const installPath = `${getInstallPath(packageType)}/${packageName}`;
    console.log(`Final package name: ${packageName}`);
    console.log(`Target installation path: ${installPath}`);

    let info: string | undefined;
    if (await pathExists(installPath)) {
        console.log(`Target directory already exists: ${installPath}`);
        info = i18n.targetDirExists.replace("{path}", installPath);

        const clearResult = await clearDirectory(installPath);
        if (clearResult.ok === false) {
            return fail(clearResult.error);
        }
        console.log(`Cleared old package files: ${installPath}`);
    } else {
        console.log(`Target directory does not exist: ${installPath}`);
    }

    console.log(`Starting to copy files from ${extractPath} to ${installPath}`);
    const copyResult = await copyToInstallPath(extractPath, installPath);
    if (copyResult.ok === false) {
        return fail(copyResult.error);
    }
    console.log(`File copy completed: ${installPath}`);

    const installDirData = await fetchSyncPost("/api/file/readDir", { path: installPath });
    console.log("Post-installation directory contents:", installDirData);

    console.log(`Package installed successfully: ${packageName}`);
    return succeed(packageType, packageName, info);
}
