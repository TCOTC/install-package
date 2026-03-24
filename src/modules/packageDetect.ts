/**
 * 下载、校验与包类型识别
 */

import { extractPackageNameFromUrl } from "./github";
import { cleanupTempFiles, unzipFile, writeTempFile } from "./fsKernel";
import { installPackageWithKernelAPI } from "./installKernel";

export type DownloadInstallResult = {
    success: boolean;
    packageType: string | null;
    packageName: string | null;
    /** 安装成功后若为图标包，由插件层调用 reloadIcon */
    shouldReloadIcon: boolean;
    error?: string;
    infos?: string[];
    enableWarnings?: string[];
};

export function validatePackageZipFile(data: Uint8Array, fileName: string): boolean {
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
): Promise<string> {
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
        throw new Error(i18n.extractedDirEmpty);
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
    }
    if (foundConfigs.length > 1) {
        throw new Error(i18n.multipleConfigFiles.replace("{files}", foundConfigs.join(", ")));
    }

    return foundConfigs[0];
}

export async function detectPackageType(
    data: Uint8Array,
    fileName: string,
    i18n: Record<string, string>
): Promise<string> {
    let tempPath = "";
    let extractPath = "";

    try {
        const tempFileName = `temp_${Date.now()}_${fileName}`;
        tempPath = `temp/export/${tempFileName}`;

        await writeTempFile(data, tempPath);

        extractPath = `temp/export/extract_${Date.now()}`;
        await unzipFile(tempPath, extractPath);

        return await detectPackageTypeFromContent(extractPath, i18n);
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
    i18n: Record<string, string>
): Promise<DownloadInstallResult> {
    const empty: DownloadInstallResult = {
        success: false,
        packageType: null,
        packageName: null,
        shouldReloadIcon: false,
    };

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s 超时

        let response: Response;
        try {
            console.log("Downloading file from GitHub:", downloadUrl);
            response = await fetch(downloadUrl, {
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Download failed: HTTP ${response.status}`);
            }
        } catch (error) {
            clearTimeout(timeoutId);
            if ((error as Error).name === "AbortError") {
                return {
                    ...empty,
                    error: i18n.downloadTimeout,
                };
            }
            throw error;
        }

        const arrayBuffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        if (!validatePackageZipFile(uint8Array, fileName)) {
            return {
                ...empty,
                error: i18n.fileValidationFailed,
            };
        }

        console.log("File validation passed, detecting package type...");

        let packageType: string;
        try {
            packageType = await detectPackageType(uint8Array, fileName, i18n);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return {
                ...empty,
                error: msg,
            };
        }

        console.log(`Package type detected: ${packageType}, installing...`);

        const packageName = extractPackageNameFromUrl(downloadUrl);
        console.log(`Package name extracted from URL: ${packageName}`);

        const kernelResult = await installPackageWithKernelAPI(
            uint8Array,
            fileName,
            packageType,
            packageName,
            enable,
            i18n
        );

        if (kernelResult.ok === false) {
            return {
                success: false,
                packageType,
                packageName,
                shouldReloadIcon: false,
                error: kernelResult.error,
            };
        }

        const shouldReloadIcon = packageType === "icon";
        return {
            success: true,
            packageType,
            packageName,
            shouldReloadIcon,
            infos: kernelResult.infos.length > 0 ? kernelResult.infos : undefined,
            enableWarnings:
                kernelResult.enableWarnings.length > 0 ? kernelResult.enableWarnings : undefined,
        };
    } catch (error) {
        console.error("Failed to download or install plugin:", error);
        const msg = error instanceof Error ? error.message : String(error);
        return {
            ...empty,
            error: i18n.installationFailed.replace("{error}", msg),
        };
    }
}
