import { i18n } from "../infra/i18n";
import { extractPackageNameFromUrl } from "./github";
import { message } from "../infra/message";
import type { Logger } from "../types";

export async function downloadPackage(
    downloadUrl: string,
    fileName: string,
    log: Logger,
    installAbort: AbortController
): Promise<{
    blob: Blob;
    fileName: string;
    packageName: string;
} | null> {
    const signal = installAbort.signal;
    // 配置下载超时
    const timeoutId = setTimeout(() => {
        message(i18n.downloadTimeout);
        installAbort.abort();
    }, 30000);

    let response: Response;
    try {
        // 下载远程文件
        log("Downloading file from GitHub:", downloadUrl);
        response = await fetch(downloadUrl, {
            signal,
        });
    } catch (error) {
        // 处理下载异常（超时或网络错误）
        clearTimeout(timeoutId);
        if ((error as Error).name === "AbortError") {
            return null;
        }
        const msg = error instanceof Error ? error.message : String(error);
        message(i18n.downloadFailed.replace("{error}", msg));
        return null;
    }

    // 清除超时定时器
    clearTimeout(timeoutId);

    // 校验 HTTP 响应状态
    if (!response.ok) {
        message(i18n.downloadFailed.replace("{error}", `HTTP ${response.status}`));
        return null;
    }

    // 读取并校验 ZIP 文件
    const blob = await readZipBody(response, log, signal);
    if (!blob) {
        if (signal.aborted) {
            return null;
        }
        message(i18n.fileValidationFailed);
        return null;
    }

    log("File validation passed");

    // 从 URL 解析包名（与 install 阶段解压目录名、元数据校验一致）
    const packageName = extractPackageNameFromUrl(downloadUrl);
    if (!packageName) {
        message(i18n.packageNameFromUrlFailed);
        return null;
    }
    log(`Package name extracted from URL: ${packageName}`);

    return { blob, fileName, packageName };
}

/**
 * 流式读满 4 字节校验 ZIP 本地文件头后再读完，避免整包读入后再发现非 ZIP；非 ZIP 时尽早 cancel。
 * 校验通过后以 chunk 拼成 Blob，避免再分配整块 Uint8Array 拷贝。
 */
async function readZipBody(response: Response, log: Logger, signal: AbortSignal): Promise<Blob | null> {
    // 正常 GET 成功时 body 为 ReadableStream；为 null 时无法按块读取
    const stream = response.body;
    if (!stream) {
        log("Response body stream is unavailable");
        return null;
    }

    // 每个 Response.body 只能被一个 reader 消费，read() 按 chunk 拉取
    let reader: ReadableStreamDefaultReader<Uint8Array>;
    const onAbort = (): void => {
        void reader?.cancel();
    };
    signal.addEventListener("abort", onAbort);
    try {
        reader = stream.getReader();
        const prefix = new Uint8Array(4);
        let prefixFilled = 0;
        const restChunks: Uint8Array[] = [];

        // 阶段 1：凑满 4 字节再验签；单块超过「当前还缺的几字节」时，尾部先放进 restChunks，保证字节序连续
        while (prefixFilled < 4) {
            if (signal.aborted) {
                return null;
            }
            const { done, value } = await reader.read();
            if (value && value.length > 0) {
                const need = 4 - prefixFilled;
                const take = Math.min(need, value.length);
                prefix.set(value.subarray(0, take), prefixFilled);
                prefixFilled += take;
                if (value.length > take) {
                    restChunks.push(value.subarray(take));
                }
            }
            if (done) {
                if (prefixFilled === 0) {
                    log("File size is 0");
                    return null;
                }
                if (prefixFilled < 4) {
                    log("ZIP file header validation failed");
                    return null;
                }
                break;
            }
        }

        // 非 ZIP 本地文件头（PK\x03\x04，即 0x50 0x4b 0x03 0x04）则取消流，避免继续拉取整包无效数据
        if (
            prefix[0] !== 0x50 ||
            prefix[1] !== 0x4b ||
            prefix[2] !== 0x03 ||
            prefix[3] !== 0x04
        ) {
            await reader.cancel();
            log("ZIP file header validation failed");
            return null;
        }

        // 阶段 2：读完流中剩余 chunk（阶段 1 已把「跨过前 4 字节的尾巴」放进 restChunks）
        while (true) {
            if (signal.aborted) {
                return null;
            }
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            if (value && value.length > 0) {
                restChunks.push(value);
            }
        }

        // TS 5.7+ 中 Uint8Array 默认带 ArrayBufferLike，与 BlobPart 的 ArrayBuffer 狭义定义不兼容，运行时与流式 chunk 一致
        return new Blob([prefix, ...restChunks] as BlobPart[]);
    } catch (error) {
        log("File validation failed:", error);
        return null;
    } finally {
        signal.removeEventListener("abort", onAbort);
    }
}
