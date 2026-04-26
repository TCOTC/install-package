/**
 * 思源内核 HTTP 封装
 */

import { i18n } from "./i18n";
import type { Logger } from "../ui/logger";

export interface KernelApiResponse {
    code: number;
    msg: string;
    data: unknown;
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

/** 删除文件或目录 */
export async function removeFile(path: string, log: Logger): Promise<boolean> {
    log.info(`Removing file: [${path}]`);
    const response = await fetchSyncPost("/api/file/removeFile", { path });
    if (response.code !== 0) {
        log.warn(`Failed to remove [${path}]: code=[${response.code}], msg=[${response.msg}]`);
        return false;
    }
    log.info(`Removed successfully`);
    return true;
}

/** 重命名文件或目录，`path` / `newPath` 均为工作空间下的路径 */
export async function renameFile(path: string, newPath: string, log: Logger): Promise<boolean> {
    const response = await fetchSyncPost("/api/file/renameFile", { path, newPath });
    if (response.code !== 0) {
        log.warn(`${i18n.renameFileFailed} [${path}] -> [${newPath}] code=[${response.code}], msg=[${response.msg}]`);
        return false;
    }
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

export async function pathExists(path: string): Promise<boolean> {
    const response = await fetchSyncPost("/api/file/readDir", { path });
    return response.code === 0 && Array.isArray(response.data);
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

    log.info(`Unzipped successfully`);
    return true;
}

// TODO 直接改成用 /api/file/renameFile 实现移动文件夹（等 PR 过了）（还需要先判断对应位置是否已经存在文件或文件夹，要先 removeFile 才能 renameFile）
/**
 * 工作空间内复制文件或目录
 * 
 * @param sourcePath 复制源。相对于工作空间的路径
 * @param targetPath 复制目标。相对于工作空间的路径
 * @param log 日志记录器
 * @returns 是否成功
 */
export async function workspaceCopyFiles(sourcePath: string, targetPath: string, log: Logger): Promise<boolean> {
    log.info(`Copying file: [${sourcePath}] -> [${targetPath}]`);
    const response = await fetchSyncPost("/api/file/workspaceCopyFiles", {
        srcs: [sourcePath],
        destDir: targetPath,
    });

    if (response.code !== 0) {
        log.warn(`Failed to copy [${sourcePath}] -> [${targetPath}]: code=[${response.code}], msg=[${response.msg}]`);
        return false;
    }

    log.info(`Copied successfully`);
    return true;
}
