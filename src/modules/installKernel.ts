/**
 * 通过内核 API 安装集市包
 */

import { getFrontend } from "siyuan";
import {
    cleanupTempFiles,
    clearDirectory,
    copyToInstallPath,
    pathExists,
    unzipFile,
    writeTempFile,
} from "./fsKernel";
import { fetchSyncPost, getFile } from "./fetchKernel";

export function getInstallPath(packageType: string, packageName: string): string {
    switch (packageType) {
        case "plugin":
            return `data/plugins/${packageName}`;
        case "widget":
            return `data/widgets/${packageName}`;
        case "template":
            return `data/templates/${packageName}`;
        case "theme":
            return `conf/appearance/themes/${packageName}`;
        case "icon":
            return `conf/appearance/icons/${packageName}`;
        default:
            return `data/plugins/${packageName}`;
    }
}

export function getMetadataFileName(packageType: string): string {
    switch (packageType) {
        case "plugin":
            return "plugin.json";
        case "widget":
            return "widget.json";
        case "template":
            return "template.json";
        case "theme":
            return "theme.json";
        case "icon":
            return "icon.json";
        default:
            return "plugin.json";
    }
}

export async function extractPackageNameFromMetadata(
    extractPath: string,
    packageType: string,
    i18n: Record<string, string>
): Promise<string> {
    console.log(`Extracting package name from metadata: ${extractPath}, type: ${packageType}`);

    const metadataFile = getMetadataFileName(packageType);
    const metadataPath = `${extractPath}/${metadataFile}`;

    console.log(`Reading package metadata file: ${metadataPath}`);

    const fileResult = await getFile(metadataPath);
    if (fileResult.ok === false) {
        throw new Error(
            i18n.extractPackageNameFromMetadataError.replace(
                "{error}",
                fileResult.msg || `code ${fileResult.code}`,
            ),
        );
    }
    let packageMetadata: Record<string, unknown>;
    try {
        packageMetadata = JSON.parse(fileResult.content);
    } catch {
        throw new Error(
            i18n.extractPackageNameFromMetadataError.replace("{error}", i18n.metadataFileInvalidJson),
        );
    }
    console.log("Package metadata:", packageMetadata);

    const packageName = (packageMetadata.name ?? packageMetadata.packageName) as string | undefined;

    if (!packageName) {
        throw new Error(i18n.packageNameNotFoundInMetadata);
    }

    console.log(`Package name extracted from metadata: ${packageName}`);

    if (typeof packageName !== "string" || packageName.trim() === "") {
        throw new Error(i18n.invalidPackageName.replace("{name}", String(packageName)));
    }

    return packageName.trim();
}

/**
 * 根据已安装主题的 theme.json 得到主题支持的所有外观模式数组（0 明亮，1 暗黑）
 * 
 * 出错时返回 [0, 1]，最多只会有内核错误日志，行为不会发生异常
 */
async function getSetThemeModes(packageName: string): Promise<number[]> {
    const themeMetadataPath = `${getInstallPath("theme", packageName)}/theme.json`;
    const fileResult = await getFile(themeMetadataPath);
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
    i18n: Record<string, string>
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
                // TODO 如果禁用主题，需要将正在使用该主题的外观模式切换回默认主题
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
                // TODO 改成 fetch "/api/setting/setIcon" 参数为 icon: packageName
                const response = await fetchSyncPost("/api/setting/setIcon", { icon: packageName });
                if (response.code === 0) {
                    console.log(`Icon ${packageName} applied successfully`);
                    return undefined;
                }
                console.error(`Failed to apply icon: ${response.msg}`);
                return i18n.enablePackageFailed.replace("{error}", String(response.msg ?? ""));
            } else {
                // TODO 如果当前正在使用该图标，需要将图标切换回默认图标
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

export type KernelInstallResult = { ok: true; info?: string } | { ok: false; error: string };

export async function installPackageWithKernelAPI(
    data: Uint8Array,
    fileName: string,
    packageType: string,
    packageName: string,
    i18n: Record<string, string>
): Promise<KernelInstallResult> {
    let tempPath = "";
    let extractPath = "";

    let info: string;

    try {
        console.log(`Starting package installation: ${fileName}, type: ${packageType}, name: ${packageName}`);

        const tempFileName = `temp_${Date.now()}_${fileName}`;
        tempPath = `temp/export/${tempFileName}`;
        console.log(`Creating temporary file: ${tempPath}`);

        await writeTempFile(data, tempPath);
        console.log(`Temporary file written successfully: ${tempPath}`);

        extractPath = `temp/export/extract_${Date.now()}/${packageName}`;
        console.log(`Extracting to final directory: ${extractPath}`);
        await unzipFile(tempPath, extractPath);
        console.log(`Extraction completed: ${extractPath}`);

        const extractDirData = await fetchSyncPost("/api/file/readDir", { path: extractPath });
        console.log("Extracted directory contents:", extractDirData);

        const metadataPackageName = await extractPackageNameFromMetadata(extractPath, packageType, i18n);
        console.log(`Package name from metadata: ${metadataPackageName}, repository name: ${packageName}`);

        if (metadataPackageName !== packageName) {
            const errorMsg = `Package name mismatch: metadata ${metadataPackageName}, repo ${packageName}`;
            console.error(errorMsg);
            return {
                ok: false,
                error: i18n.packageNameMismatch
                    .replace("{metadataName}", metadataPackageName)
                    .replace("{repoName}", packageName),
            };
        }

        console.log("Package name verification passed");

        const installPath = getInstallPath(packageType, packageName);
        console.log(`Final package name: ${packageName}`);
        console.log(`Target installation path: ${installPath}`);

        if (await pathExists(installPath)) {
            console.log(`Target directory already exists: ${installPath}`);
            info = i18n.targetDirExists.replace("{path}", installPath);

            await clearDirectory(installPath);
            console.log(`Cleared old package files: ${installPath}`);
        } else {
            console.log(`Target directory does not exist: ${installPath}`);
        }

        console.log(`Starting to copy files from ${extractPath} to ${installPath}`);
        await copyToInstallPath(extractPath, installPath);
        console.log(`File copy completed: ${installPath}`);

        const installDirData = await fetchSyncPost("/api/file/readDir", { path: installPath });
        console.log("Post-installation directory contents:", installDirData);

        console.log(`Package installed successfully: ${packageName}`);
        return { ok: true, info };
    } catch (error) {
        console.error("Package installation failed:", error);
        if (error instanceof Error) {
            return { ok: false, error: error.message };
        }
        return {
            ok: false,
            error: i18n.installationFailed.replace("{error}", String(error)),
        };
    } finally {
        const extractBaseDir = extractPath ? extractPath.substring(0, extractPath.lastIndexOf("/")) : "";
        const pathsToClean = [tempPath, extractBaseDir].filter(Boolean);
        if (pathsToClean.length > 0) {
            console.log(`Cleaning up temporary files: ${pathsToClean.join(", ")}`);
            await cleanupTempFiles(pathsToClean);
        }
    }
}
