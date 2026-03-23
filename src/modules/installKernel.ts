/**
 * 通过内核 API 安装包、路径与启用状态
 */

import { fetchSyncPost, getFrontend } from "siyuan";
import {
    cleanupTempFiles,
    clearDirectory,
    copyToInstallPath,
    pathExists,
    unzipFile,
    writeTempFile,
} from "./fsKernel";

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

export function getConfigFileName(packageType: string): string {
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

export async function extractPackageNameFromContent(
    extractPath: string,
    packageType: string,
    i18n: Record<string, string>
): Promise<string> {
    console.log(`Extracting package name from content: ${extractPath}, type: ${packageType}`);

    const configFile = getConfigFileName(packageType);
    const configPath = `${extractPath}/${configFile}`;

    console.log(`Reading configuration file: ${configPath}`);

    const response = await fetch("/api/file/getFile", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            path: configPath,
        }),
    });

    if (response.status !== 200) {
        throw new Error(
            i18n.extractPackageNameError.replace(
                "{error}",
                `read ${configFile}: HTTP ${response.status}`
            )
        );
    }

    const configData = await response.json();
    console.log("Configuration file content:", configData);

    const packageName = configData.name || configData.packageName;

    if (!packageName) {
        throw new Error(i18n.packageNameNotFound);
    }

    console.log(`Package name extracted from configuration file: ${packageName}`);

    if (typeof packageName !== "string" || packageName.trim() === "") {
        throw new Error(i18n.invalidPackageName.replace("{name}", String(packageName)));
    }

    return packageName.trim();
}

export async function setPackageEnabled(
    packageType: string,
    packageName: string,
    enabled: boolean,
    i18n: Record<string, string>
): Promise<string | undefined> {
    try {
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
            default:
                console.log(`${packageType} ${packageName} installed`);
                return undefined;
        }
    } catch (error) {
        const action = enabled ? "enable" : "disable";
        console.error(`Failed to ${action} package:`, error);
        const msg = error instanceof Error ? error.message : String(error);
        const tpl = enabled ? i18n.enablePackageFailed : i18n.disablePackageFailed;
        return tpl.replace("{error}", msg);
    }
}

export type KernelInstallResult =
    | { ok: true; infos: string[]; enableWarnings: string[] }
    | { ok: false; error: string };

export async function installPackageWithKernelAPI(
    data: Uint8Array,
    fileName: string,
    packageType: string,
    packageName: string,
    enable: boolean,
    i18n: Record<string, string>
): Promise<KernelInstallResult> {
    let tempPath = "";
    let extractPath = "";

    const infos: string[] = [];
    const enableWarnings: string[] = [];

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

        const extractDirResponse = await fetch("/api/file/readDir", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                path: extractPath,
            }),
        });

        if (extractDirResponse.ok) {
            const extractDirData = await extractDirResponse.json();
            console.log("Extracted directory contents:", extractDirData);
        }

        const configPackageName = await extractPackageNameFromContent(extractPath, packageType, i18n);
        console.log(`Package name from config: ${configPackageName}, repository name: ${packageName}`);

        if (configPackageName !== packageName) {
            const errorMsg = `Package name mismatch: config ${configPackageName}, repo ${packageName}`;
            console.error(errorMsg);
            return {
                ok: false,
                error: i18n.packageNameMismatch
                    .replace("{configName}", configPackageName)
                    .replace("{repoName}", packageName),
            };
        }

        console.log("Package name verification passed");

        const installPath = getInstallPath(packageType, packageName);
        console.log(`Final package name: ${packageName}`);
        console.log(`Target installation path: ${installPath}`);

        if (await pathExists(installPath)) {
            console.log(`Target directory already exists: ${installPath}`);
            infos.push(i18n.targetDirExists.replace("{path}", installPath));

            await clearDirectory(installPath);
            console.log(`Cleared old package files: ${installPath}`);
        } else {
            console.log(`Target directory does not exist: ${installPath}`);
        }

        console.log(`Starting to copy files from ${extractPath} to ${installPath}`);
        await copyToInstallPath(extractPath, installPath);
        console.log(`File copy completed: ${installPath}`);

        const installDirResponse = await fetch("/api/file/readDir", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                path: installPath,
            }),
        });

        if (installDirResponse.ok) {
            const installDirData = await installDirResponse.json();
            console.log("Post-installation directory contents:", installDirData);
        } else {
            console.error(`Unable to verify installation result: ${installDirResponse.status}`);
        }

        console.log(`Attempting to ${enable ? "enable" : "disable"} package: ${packageType} - ${packageName}`);
        const enableWarning = await setPackageEnabled(packageType, packageName, enable, i18n);
        if (enableWarning) {
            enableWarnings.push(enableWarning);
        }

        console.log(`Package installed successfully: ${packageName}`);
        return { ok: true, infos, enableWarnings };
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
