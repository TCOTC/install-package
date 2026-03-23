/**
 * 下载、校验与包类型识别
 */

import { extractPackageNameFromUrl } from "./github";
import { cleanupTempFiles, unzipFile, writeTempFile } from "./fsKernel";
import { installPackageWithKernelAPI, type InstallFlowContext } from "./installKernel";

export function validatePluginFile(data: Uint8Array, fileName: string): boolean {
    try {
        if (data.length === 0) {
            console.error("File size is 0");
            return false;
        }

        if (fileName.toLowerCase() !== "package.zip") {
            console.error("File name must be package.zip");
            return false;
        }

        if (data.length >= 2 && data[0] === 0x50 && data[1] === 0x4b) {
            return true;
        } else {
            console.error("ZIP file header validation failed");
            return false;
        }
    } catch (error) {
        console.error("File validation failed:", error);
        return false;
    }
}

export async function detectPackageTypeFromContent(
    extractPath: string,
    i18n: Record<string, string>
): Promise<string | null> {
    try {
        console.log(`Checking extracted directory: ${extractPath}`);

        const dirResponse = await fetch("/api/file/readDir", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                path: extractPath,
            }),
        });

        if (!dirResponse.ok) {
            throw new Error(`Unable to read extracted directory: ${dirResponse.status}`);
        }

        const dirData = await dirResponse.json();
        console.log("Extracted directory contents:", dirData);

        if (!dirData.data || !Array.isArray(dirData.data)) {
            throw new Error(i18n.extractedDirEmpty);
        }

        const fileNames = dirData.data.map((item: any) => item.name || item);
        console.log("File list:", fileNames);

        const configFiles = [
            { file: "plugin.json", type: "plugin" },
            { file: "widget.json", type: "widget" },
            { file: "template.json", type: "template" },
            { file: "theme.json", type: "theme" },
            { file: "icon.json", type: "icon" },
        ];

        const foundConfigs: string[] = [];

        for (const config of configFiles) {
            if (fileNames.includes(config.file)) {
                foundConfigs.push(config.type);
                console.log(`Found configuration file: ${config.type}`);
            }
        }

        console.log("Found configuration files:", foundConfigs);

        if (foundConfigs.length === 0) {
            throw new Error(i18n.noConfigFiles);
        } else if (foundConfigs.length > 1) {
            throw new Error(i18n.multipleConfigFiles.replace("{files}", foundConfigs.join(", ")));
        }

        return foundConfigs[0];
    } catch (error) {
        console.warn("Failed to detect package type from content:", error);
        throw error;
    }
}

export async function detectPackageType(
    data: Uint8Array,
    fileName: string,
    i18n: Record<string, string>
): Promise<string | null> {
    let tempPath = "";
    let extractPath = "";

    try {
        const tempFileName = `temp_${Date.now()}_${fileName}`;
        tempPath = `temp/export/${tempFileName}`;

        await writeTempFile(data, tempPath);

        extractPath = `temp/export/extract_${Date.now()}`;
        await unzipFile(tempPath, extractPath);

        const packageType = await detectPackageTypeFromContent(extractPath, i18n);

        return packageType;
    } catch (error) {
        console.error("Failed to detect package type:", error);
        return null;
    } finally {
        if (tempPath || extractPath) {
            console.log(`Cleaning up temporary files: ${tempPath}, ${extractPath}`);
            await cleanupTempFiles([tempPath, extractPath].filter(Boolean));
        }
    }
}

export async function downloadAndInstallPlugin(
    downloadUrl: string,
    fileName: string,
    enable: boolean,
    ctx: InstallFlowContext
): Promise<{ success: boolean; packageType: string | null }> {
    const { i18n, showMessage } = ctx;
    try {
        console.log("Downloading file from GitHub...");

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        let response: Response;
        try {
            response = await fetch(downloadUrl, {
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Download failed: HTTP ${response.status}`);
            }
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === "AbortError") {
                throw new Error(i18n.downloadTimeout);
            }
            throw error;
        }

        const arrayBuffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        if (!validatePluginFile(uint8Array, fileName)) {
            showMessage(i18n.fileValidationFailed, "error");
            return { success: false, packageType: null };
        }

        console.log("File validation passed, detecting package type...");

        let packageType: string | null;
        try {
            packageType = await detectPackageType(uint8Array, fileName, i18n);
        } catch (error) {
            showMessage(i18n.packageTypeDetectionFailed.replace("{error}", error.message), "error");
            return { success: false, packageType: null };
        }

        if (!packageType) {
            showMessage(i18n.packageTypeUnknown, "error");
            return { success: false, packageType: null };
        }

        console.log(`Package type detected: ${packageType}, installing...`);

        const packageName = extractPackageNameFromUrl(downloadUrl);
        console.log(`Package name extracted from URL: ${packageName}`);

        const success = await installPackageWithKernelAPI(
            uint8Array,
            fileName,
            packageType,
            packageName,
            enable,
            ctx
        );

        if (success) {
            let autoEnabledText = "";
            if (packageType === "plugin") {
                autoEnabledText = enable
                    ? i18n.packageInstalledSuccessAuto
                    : i18n.packageInstalledSuccessManual;
            } else if (packageType === "widget" || packageType === "template") {
                // 挂件和模板没有「启用」的概念
            } else if (packageType === "theme" || packageType === "icon") {
                autoEnabledText = i18n.packageInstalledSuccessManual;
            }
            showMessage(
                i18n.packageInstalledSuccess
                    .replace("{packageType}", packageType)
                    .replace("{packageName}", packageName)
                    .replace("{autoEnabled}", autoEnabledText),
                "info"
            );
        } else {
            showMessage(i18n.packageInstallFailed, "error");
        }

        return { success, packageType };
    } catch (error) {
        console.error("Failed to download or install plugin:", error);
        showMessage(i18n.installationFailed.replace("{error}", error.message), "error");
        return { success: false, packageType: null };
    }
}
