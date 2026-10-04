import { i18n } from "../infra/i18n";
import { extractPackageNameFromUrl } from "./github";
import type { Logger } from "../infra/logger";

/** 下载进度回调：`loaded` 为已接收字节数，`total` 为 Release 资源声明的总字节数 */
export type DownloadProgressCallback = (loaded: number, total: number) => void;

/**
 * 下载进度参数
 *
 * `totalBytes` 取 Release 资源的 `size` 而非响应头的 `Content-Length`：资源会跳转到对象存储，
 * 前者零额外请求且不依赖跳转后的响应头
 */
export interface DownloadProgressOptions {
    totalBytes: number;
    onProgress?: DownloadProgressCallback;
}

/** 停滞提示阈值：超过该时长没有收到任何新数据就提示一次，但不中止连接 */
const DOWNLOAD_STALL_MS = 10000;

/**
 * 下载失败原因
 *
 * `aborted` 为用户主动中断；`network` 为请求或传输失败；`invalid` 为响应内容不是有效 ZIP；
 * `unrecognized` 为下载成功但无法从地址推出仓库名
 */
export type DownloadFailureReason = "aborted" | "network" | "invalid" | "unrecognized";

/**
 * 下载结果
 *
 * 以结构化原因代替 `null`：调用方需要区分「网络中断」与「文件本身无效」才能给出正确提示，
 * 后者的文案是「文件不是 ZIP 压缩包或者文件不完整」，用在网络故障上会把用户引向错误方向
 */
export type DownloadResult =
    | {
        ok: true;
        blob: Blob;
        fileName: string;
        /** 仅由下载 URL 推得的仓库名，仅用于日志与「与元数据包名是否一致」的提示；不参与安装路径计算 */
        repoPackageName: string;
    }
    | {
        ok: false;
        reason: DownloadFailureReason;
        /** 仅当响应状态码非 2xx 时给出 */
        status?: number;
        /** 失败前已接收的字节数，供调用方在日志里说明已下载到哪里 */
        loadedBytes: number;
        totalBytes: number;
    };

/** 读流的中间结果；不在此处打印日志，统一由调用方根据原因给出提示 */
type ZipBodyResult =
    | { ok: true; blob: Blob }
    | { ok: false; reason: "aborted" | "network" | "invalid"; loaded: number };

export async function downloadPackage(
    downloadUrl: string,
    fileName: string,
    log: Logger,
    installAbort: AbortController,
    progress?: DownloadProgressOptions
): Promise<DownloadResult> {
    const signal = installAbort.signal;
    const totalBytes = progress?.totalBytes ?? 0;

    /**
     * 停滞看门狗：连接或传输长时间没有新数据时只在日志里提示，不中止连接。
     *
     * 停滞多由代理或网络抖动引起，链路恢复后同一个连接仍可能继续传输，
     * 自动中断反而会打断一次本可自行恢复的下载，因此把是否结束下载留给用户决定；
     * 提示也只在「刚进入停滞」时给一次，避免停滞期间反复刷日志
     */
    let stallTimerId: number | undefined;
    let stalled = false;
    const clearStallTimer = (): void => {
        window.clearTimeout(stallTimerId);
        stallTimerId = undefined;
    };
    const armStallTimer = (): void => {
        clearStallTimer();
        if (stalled) {
            return;
        }
        stallTimerId = window.setTimeout(() => {
            stallTimerId = undefined;
            stalled = true;
            log.warn(i18n.downloadStalled.replace("{seconds}", String(DOWNLOAD_STALL_MS / 1000)));
        }, DOWNLOAD_STALL_MS);
    };
    /** 每收到一块数据即视为链路仍活，结束停滞状态并重新计时 */
    const noteData = (): void => {
        stalled = false;
        armStallTimer();
    };

    // 先计时再发请求，使「建立连接与等待响应头」阶段也纳入同一套停滞检测
    armStallTimer();
    try {
        // 下载远程文件
        log.info("Downloading file from GitHub:", downloadUrl);
        let response: Response;
        try {
            response = await fetch(downloadUrl, {
                signal,
            });
        } catch (error) {
            // 点击「中断安装」会以 AbortError 结束请求，与网络错误区分开
            if ((error as Error).name === "AbortError") {
                return { ok: false, reason: "aborted", loadedBytes: 0, totalBytes };
            }
            return { ok: false, reason: "network", loadedBytes: 0, totalBytes };
        }

        // 校验 HTTP 响应状态
        if (!response.ok) {
            return { ok: false, reason: "network", status: response.status, loadedBytes: 0, totalBytes };
        }

        // 读取并校验 ZIP 文件
        const body = await readZipBody(response, signal, progress, noteData);
        if (!body.ok) {
            return { ok: false, reason: body.reason, loadedBytes: body.loaded, totalBytes };
        }

        // 地址形态异常时无法推出仓库名，与内容无效是两回事，单独回报原因
        const repoPackageName = extractPackageNameFromUrl(downloadUrl);
        if (!repoPackageName) {
            return { ok: false, reason: "unrecognized", loadedBytes: body.blob.size, totalBytes };
        }

        return { ok: true, blob: body.blob, fileName, repoPackageName };
    } finally {
        clearStallTimer();
    }
}

/**
 * 流式读满 4 字节校验 ZIP 本地文件头后再读完，避免整包读入后再发现非 ZIP；非 ZIP 时尽早 cancel。
 * 校验通过后以 chunk 拼成 Blob，避免再分配整块 Uint8Array 拷贝。
 * 读取过程中按已接收字节数回调 `progress.onProgress`；每块只累加长度，不做额外拷贝。
 * 每收到一块数据还会回调 `onData`（不经节流），供调用方做停滞检测。
 * 失败时不在此处打印日志，只回报原因，由调用方给出对应提示
 */
async function readZipBody(
    response: Response,
    signal: AbortSignal,
    progress?: DownloadProgressOptions,
    onData?: () => void
): Promise<ZipBodyResult> {
    // 正常 GET 成功时 body 为 ReadableStream；为 null 时无法按块读取
    const stream = response.body;
    if (!stream) {
        return { ok: false, reason: "invalid", loaded: 0 };
    }

    const totalBytes = progress?.totalBytes ?? 0;
    const onProgress = progress?.onProgress;
    let loaded = 0;
    const reportProgress = (): void => {
        if (onProgress !== undefined && totalBytes > 0) {
            // 实际大小可能略大于资源声明值，钳到总量避免百分比越界
            onProgress(Math.min(loaded, totalBytes), totalBytes);
        }
    };

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
                return { ok: false, reason: "aborted", loaded };
            }
            const { done, value } = await reader.read();
            // 用户中断时 onAbort 会 cancel()，而 cancel 会把挂起中的 read() 以 done 结算，
            // 因此读到后需再确认一次是否已中止
            if (signal.aborted) {
                return { ok: false, reason: "aborted", loaded };
            }
            if (value && value.length > 0) {
                loaded += value.length;
                onData?.();
                reportProgress();
                const need = 4 - prefixFilled;
                const take = Math.min(need, value.length);
                prefix.set(value.subarray(0, take), prefixFilled);
                prefixFilled += take;
                if (value.length > take) {
                    restChunks.push(value.subarray(take));
                }
            }
            if (done) {
                // 不足 4 字节说明响应体为空或被截断，两者都不是有效 ZIP
                if (prefixFilled < 4) {
                    return { ok: false, reason: "invalid", loaded };
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
            return { ok: false, reason: "invalid", loaded };
        }

        // 阶段 2：读完流中剩余 chunk（阶段 1 已把「跨过前 4 字节的尾巴」放进 restChunks）
        while (true) {
            if (signal.aborted) {
                return { ok: false, reason: "aborted", loaded };
            }
            const { done, value } = await reader.read();
            // 同阶段 1：中止会让 read() 以 done 结算，若当作流正常结束，就会用残缺数据继续后续流程
            if (signal.aborted) {
                return { ok: false, reason: "aborted", loaded };
            }
            if (done) {
                break;
            }
            if (value && value.length > 0) {
                loaded += value.length;
                onData?.();
                reportProgress();
                restChunks.push(value);
            }
        }

        // 流正常结束即视为下载完成，补报一次 100%（资源声明大小与实际可能略有出入）
        if (onProgress !== undefined && totalBytes > 0) {
            onProgress(totalBytes, totalBytes);
        }

        // TS 5.7+ 中 Uint8Array 默认带 ArrayBufferLike，与 BlobPart 的 ArrayBuffer 狭义定义不兼容，运行时与流式 chunk 一致
        return { ok: true, blob: new Blob([prefix, ...restChunks] as BlobPart[]) };
    } catch {
        // 传输中途失败（网络断开、代理中断等）会以网络错误结算，而不是一直挂起
        return { ok: false, reason: "network", loaded };
    } finally {
        signal.removeEventListener("abort", onAbort);
    }
}
