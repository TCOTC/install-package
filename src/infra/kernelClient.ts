/**
 * 思源内核 HTTP 封装
 */

import { i18n } from "./i18n";
import type { Logger } from "../ui/logger";

export interface KernelApiResponse {
    code: number;
    msg: string;
    data: unknown;
    /** 请求未能到达内核（断网、连接被拒、响应不可解析等），用于与内核返回的业务错误区分 */
    transportFailed?: boolean;
}

export async function fetchSyncPost(url: string, data?: object): Promise<KernelApiResponse> {
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(data ?? {}),
        });
        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
        }
        return await response.json() as KernelApiResponse;
    } catch (error) {
        return {
            code: -1,
            msg: error instanceof Error ? error.message : String(error),
            data: null,
        };
    }
}

/**
 * `/api/file/putFile`：HTTP Multipart
 * - path：工作空间路径下的文件路径
 * - isDir：为 true 时仅创建文件夹，忽略 file
 * - modTime：最近访问和修改时间，Unix 毫秒时间戳（与内核 millisecond2Time 一致）；默认当前时间
 * - file：上传的文件（isDir 为 true 时不应依赖此字段）
 * 返回值：{ code, msg, data }
 */
export interface PutFileParams {
    path: string;
    isDir?: boolean;
    modTime?: number;
    file?: Blob;
}

export async function putFile(params: PutFileParams): Promise<KernelApiResponse> {
    const formData = new FormData();
    formData.append("path", params.path);
    formData.append("isDir", String(params.isDir ?? false));
    formData.append("modTime", String(params.modTime ?? Date.now()));
    if (params.file && !(params.isDir ?? false)) {
        const fileName = params.path.split("/").pop() || "file";
        formData.append("file", params.file, fileName);
    }

    try {
        const response = await fetch("/api/file/putFile", {
            method: "POST",
            body: formData,
        });
        if (!response.ok) {
            return {
                code: -1,
                msg: `HTTP error: ${response.status} ${response.statusText}`,
                data: null,
            };
        }
        return (await response.json()) as KernelApiResponse;
    } catch (error) {
        return {
            code: -1,
            msg: error instanceof Error ? error.message : String(error),
            data: null,
        };
    }
}

/** `/api/file/getFile`：200 为文件正文，202 为 JSON 异常体（含 code / msg） */
export type GetFileResult =
    | { ok: true; content: string }
    | { ok: false; code: number; msg: string };

export async function getFile(path: string): Promise<GetFileResult> {
    try {
        const response = await fetch("/api/file/getFile", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ path }),
        });
        if (response.status === 200) {
            const content = await response.text();
            return { ok: true, content };
        }
        if (response.status === 202) {
            const body = (await response.json()) as KernelApiResponse;
            const code = typeof body.code === "number" ? body.code : -1;
            const msg = typeof body.msg === "string" ? body.msg : "";
            return { ok: false, code, msg };
        }
        return {
            ok: false,
            code: -1,
            msg: `HTTP error: ${response.status} ${response.statusText}`,
        };
    } catch (error) {
        return {
            ok: false,
            code: -1,
            msg: error instanceof Error ? error.message : String(error),
        };
    }
}

/** `/api/file/getFile`：200 为文件正文（按二进制读取为 Blob），202 为 JSON 异常体（含 code / msg） */
export async function getFileBlob(path: string, log: Logger): Promise<Blob | null> {
    try {
        const response = await fetch("/api/file/getFile", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ path }),
        });
        if (response.status === 200) {
            return await response.blob();
        }
        if (response.status === 202) {
            const body = (await response.json()) as KernelApiResponse;
            log.warn(`Failed to read [${path}]: code=[${body.code}], msg=[${body.msg}]`);
            return null;
        }
        log.warn(`Failed to read [${path}]: HTTP ${response.status} ${response.statusText}`);
        return null;
    } catch (error) {
        log.warn(`Failed to read [${path}]:`, error);
        return null;
    }
}

/** 删除文件或目录 */
export async function removeFile(path: string, log: Logger): Promise<boolean> {
    log.info(`Removing file: [${path}]`);
    const response = await fetchSyncPost("/api/file/removeFile", { path });
    if (response.code !== 0) {
        log.warn(`Failed to remove [${path}]: code=[${response.code}], msg=[${response.msg}]`);
        return false;
    }
    log.info("Removed successfully");
    return true;
}

export interface ReadDirEntry {
    isDir: boolean;
    isSymlink: boolean;
    name: string;
    updated: number;
}

/**
 * 读取目录；失败时写日志并返回 null
 */
export async function readDir(path: string, log: Logger): Promise<ReadDirEntry[] | null> {
    const response = await fetchSyncPost("/api/file/readDir", { path });
    if (response.code !== 0 || !Array.isArray(response.data)) {
        log.warn(i18n.readDirFailed, response.msg);
        return null;
    }
    return response.data as ReadDirEntry[];
}

export async function unzipFile(zipPath: string, extractPath: string, log: Logger): Promise<boolean> {
    log.info(`Unzipping file: [${zipPath}] -> [${extractPath}]`);

    const response = await fetchSyncPost("/api/archive/unzip", {
        zipPath: zipPath,
        path: extractPath,
    });
    if (response.code !== 0) {
        log.warn(`Failed to unzip file [${zipPath}] -> [${extractPath}]: code=[${response.code}], msg=[${response.msg}]`);
        return false;
    }

    log.info("Unzipped successfully");
    return true;
}

/** `/api/archive/zip`：把工作空间内的目录打包为 ZIP */
export async function zipFile(path: string, zipPath: string, log: Logger): Promise<boolean> {
    log.info(`Zipping: [${path}] -> [${zipPath}]`);
    const response = await fetchSyncPost("/api/archive/zip", { path, zipPath });
    if (response.code !== 0) {
        log.warn(`Failed to zip [${path}] -> [${zipPath}]: code=[${response.code}], msg=[${response.msg}]`);
        return false;
    }
    log.info("Zipped successfully");
    return true;
}

/**
 * `/api/bazaar/installLocalBazaarPackage`：上传 ZIP 交由内核安装集市包
 *
 * 内核负责校验兼容性、整目录替换与缓存清理，并在安装完成后向所有前端推送集市变更，
 * 因此由内核落盘的集市包会在主窗口与设置窗口同步刷新
 *
 * `overwrite` 固定为 true：目标目录已存在且非空时直接覆盖，不覆盖则由内核返回 `package-exists`
 */
export async function installLocalBazaarPackage(blob: Blob, fileName: string, frontend: string): Promise<KernelApiResponse> {
    const formData = new FormData();
    formData.append("file", blob, fileName);
    formData.append("frontend", frontend);
    formData.append("overwrite", "true");

    try {
        const response = await fetch("/api/bazaar/installLocalBazaarPackage", {
            method: "POST",
            body: formData,
        });
        if (!response.ok) {
            return {
                code: -1,
                msg: `HTTP error: ${response.status} ${response.statusText}`,
                data: null,
            };
        }
        return (await response.json()) as KernelApiResponse;
    } catch (error) {
        // 断网、连接被拒、响应不可解析都走这里：内核并未处理该请求，与内核返回的失败原因不同
        return {
            code: -1,
            msg: error instanceof Error ? error.message : String(error),
            data: null,
            transportFailed: true,
        };
    }
}
