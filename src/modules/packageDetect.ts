/**
 * 下载、校验与包类型识别
 */

import { extractPackageNameFromUrl } from "./github";
import { cleanupTempFiles, unzipFile, writeTempFile } from "./fsKernel";
import { installPackageWithKernelAPI } from "./installKernel";
import { fetchSyncPost } from "./fetchKernel";

export type DownloadInstallResult = {
    success: boolean;
    packageType: string | null;
    packageName: string | null;
    error?: string;
    info?: string;
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

export async function detectPackageTypeFromMetadata(
    extractPath: string,
    i18n: Record<string, string>
): Promise<string> {
    console.log(`Checking extracted directory: ${extractPath}`);

    const response = await fetchSyncPost("/api/file/readDir", { path: extractPath });
    console.log("Extracted directory contents:", response);

    if (response.code !== 0 || !Array.isArray(response.data)) {
        throw new Error(i18n.extractedDirEmpty);
    }

    const fileNames = response.data.map((item: any) => item.name || item);
    console.log("File list:", fileNames);

    const metadataFileIndex = [
        { file: "plugin.json", type: "plugin" },
        { file: "widget.json", type: "widget" },
        { file: "template.json", type: "template" },
        { file: "theme.json", type: "theme" },
        { file: "icon.json", type: "icon" },
    ];

    const foundPackageTypes: string[] = [];

    for (const entry of metadataFileIndex) {
        if (fileNames.includes(entry.file)) {
            foundPackageTypes.push(entry.type);
            console.log(`Found package metadata file (${entry.type}): ${entry.file}`);
        }
    }

    console.log("Package types inferred from metadata files:", foundPackageTypes);

    if (foundPackageTypes.length === 0) {
        throw new Error(i18n.noMetadataFiles);
    }
    if (foundPackageTypes.length > 1) {
        throw new Error(i18n.multipleMetadataFiles.replace("{files}", foundPackageTypes.join(", ")));
    }

    return foundPackageTypes[0];
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

        return await detectPackageTypeFromMetadata(extractPath, i18n);
    } finally {
        if (tempPath || extractPath) {
            console.log(`Cleaning up temporary files: ${tempPath}, ${extractPath}`);
            await cleanupTempFiles([tempPath, extractPath].filter(Boolean));
        }
    }
}

export async function downloadAndInstallPackage(
    downloadUrl: string,
    fileName: string,
    i18n: Record<string, string>
): Promise<DownloadInstallResult> {
    const empty: DownloadInstallResult = {
        success: false,
        packageType: null,
        packageName: null,
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
            i18n
        );

        if (kernelResult.ok === false) {
            return {
                success: false,
                packageType,
                packageName,
                error: kernelResult.error,
            };
        }

        return {
            success: true,
            packageType,
            packageName,
            info: kernelResult.info,
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
