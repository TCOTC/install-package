/**
 * 通过内核 API 安装包、路径与启用状态
 */

import { fetchPost, getFrontend } from "siyuan";
import {
    cleanupTempFiles,
    clearDirectory,
    copyToInstallPath,
    pathExists,
    unzipFile,
    writeTempFile,
} from "./fsKernel";

/** 安装流程在模块间共享的上下文（i18n、提示、图标刷新） */
export interface InstallFlowContext {
    i18n: Record<string, string>;
    showMessage: (message: string, type?: "info" | "error") => void;
    reloadIcon: () => Promise<void>;
}

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
    try {
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
            throw new Error(`Unable to read configuration file ${configFile}: ${response.status}`);
        }

        const configData = await response.json();
        console.log(`Configuration file content:`, configData);

        const packageName = configData.name || configData.packageName;

        if (!packageName) {
            throw new Error(i18n.packageNameNotFound);
        }

        console.log(`Package name extracted from configuration file: ${packageName}`);

        if (typeof packageName !== "string" || packageName.trim() === "") {
            throw new Error(i18n.invalidPackageName.replace("{name}", String(packageName)));
        }

        return packageName.trim();
    } catch (error) {
        console.error("Failed to extract package name from content:", error);
        throw new Error(i18n.extractPackageNameError.replace("{error}", error.message));
    }
}

export async function setPackageEnabled(
    packageType: string,
    packageName: string,
    enabled: boolean,
    ctx: InstallFlowContext
): Promise<void> {
    const { i18n, showMessage } = ctx;
    try {
        switch (packageType) {
            case "plugin": {
                const action = enabled ? "enable" : "disable";
                console.log(`Attempting to ${action} plugin: ${packageName}`);
                fetchPost(
                    "/api/petal/setPetalEnabled",
                    {
                        packageName: packageName,
                        enabled: enabled,
                        frontend: getFrontend(),
                    },
                    (response) => {
                        if (response.code === 0) {
                            console.log(`Plugin ${packageName} ${action}d successfully`);
                        } else {
                            console.error(`Failed to ${action} plugin: ${response.msg}`);
                            const errorMsg = enabled
                                ? i18n.enablePluginFailed.replace("{error}", response.msg)
                                : i18n.disablePluginFailed.replace("{error}", response.msg);
                            showMessage(errorMsg, "error");
                        }
                    }
                );
                break;
            }
            default:
                console.log(`${packageType} ${packageName} installed`);
        }
    } catch (error) {
        const action = enabled ? "enable" : "disable";
        console.error(`Failed to ${action} package:`, error);
        const errorMsg = enabled
            ? i18n.enablePackageFailed.replace("{error}", error.message)
            : i18n.disablePackageFailed.replace("{error}", error.message);
        showMessage(errorMsg, "error");
    }
}

export async function installPackageWithKernelAPI(
    data: Uint8Array,
    fileName: string,
    packageType: string,
    packageName: string,
    enable: boolean,
    ctx: InstallFlowContext
): Promise<boolean> {
    const { i18n, showMessage, reloadIcon } = ctx;
    let tempPath = "";
    let extractPath = "";

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
            const errorMsg = i18n.packageNameMismatch
                .replace("{configName}", configPackageName)
                .replace("{repoName}", packageName);
            showMessage(errorMsg, "error");
            console.error(errorMsg);
            return false;
        }

        console.log("Package name verification passed");

        const installPath = getInstallPath(packageType, packageName);
        console.log(`Final package name: ${packageName}`);
        console.log(`Target installation path: ${installPath}`);

        if (await pathExists(installPath)) {
            console.log(`Target directory already exists: ${installPath}`);
            showMessage(i18n.targetDirExists.replace("{path}", installPath), "info");

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
        await setPackageEnabled(packageType, packageName, enable, ctx);

        if (packageType === "icon") {
            console.log(`Icon package installed, calling reloadIcon API...`);
            await reloadIcon();
        }

        console.log(`Package installed successfully: ${packageName}`);
        return true;
    } catch (error) {
        console.error("Package installation failed:", error);
        showMessage(i18n.installationFailed.replace("{error}", error.message), "error");
        return false;
    } finally {
        const extractBaseDir = extractPath ? extractPath.substring(0, extractPath.lastIndexOf("/")) : "";
        const pathsToClean = [tempPath, extractBaseDir].filter(Boolean);
        if (pathsToClean.length > 0) {
            console.log(`Cleaning up temporary files: ${pathsToClean.join(", ")}`);
            await cleanupTempFiles(pathsToClean);
        }
    }
}
