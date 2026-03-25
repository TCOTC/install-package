import { i18n } from "./i18n";
import { extractPackageNameFromUrl } from "./github";

export type DownloadPackageResult =
    | {
          success: true;
          uint8Array: Uint8Array;
          fileName: string;
          packageName: string;
      }
    | {
          success: false;
          packageName: string | null;
          error?: string;
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

export async function downloadPackage(downloadUrl: string, fileName: string): Promise<DownloadPackageResult> {
    const empty: DownloadPackageResult = {
        success: false,
        packageName: null,
    };

    try {
        // 配置下载超时
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s 超时

        let response: Response;
        try {
            // 下载远程文件
            console.log("Downloading file from GitHub:", downloadUrl);
            response = await fetch(downloadUrl, {
                signal: controller.signal,
            });
        } catch (error) {
            // 处理下载异常（超时或网络错误）
            clearTimeout(timeoutId);
            if ((error as Error).name === "AbortError") {
                return {
                    ...empty,
                    error: i18n.downloadTimeout,
                };
            }
            const msg = error instanceof Error ? error.message : String(error);
            return {
                ...empty,
                error: i18n.downloadFailed.replace("{error}", msg),
            };
        }

        // 清除超时定时器
        clearTimeout(timeoutId);

        // 校验 HTTP 响应状态
        if (!response.ok) {
            return {
                ...empty,
                error: i18n.downloadFailed.replace("{error}", `HTTP ${response.status}`),
            };
        }

        // 读取响应体为二进制数据
        const arrayBuffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        // 校验 ZIP 包
        if (!validatePackageZipFile(uint8Array, fileName)) {
            return {
                ...empty,
                error: i18n.fileValidationFailed,
            };
        }

        console.log("File validation passed");

        // 从 URL 解析包名（与 install 阶段解压目录名、元数据校验一致）
        const packageName = extractPackageNameFromUrl(downloadUrl);
        if (!packageName) {
            return {
                ...empty,
                error: i18n.packageNameFromUrlFailed,
            };
        }
        console.log(`Package name extracted from URL: ${packageName}`);

        return {
            success: true,
            uint8Array,
            fileName,
            packageName,
        };
    } catch (error) {
        // 兜底：未预期的异常
        console.error("Failed to download package:", error);
        const msg = error instanceof Error ? error.message : String(error);
        return {
            ...empty,
            error: i18n.downloadFailed.replace("{error}", msg),
        };
    }
}
