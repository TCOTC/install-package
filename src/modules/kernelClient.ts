/**
 * 思源内核 HTTP 封装：JSON POST（fetchSyncPost）、getFile、multipart putFile
 */

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
 * - modTime：最近访问和修改时间，Unix 时间戳（秒）；默认当前时间
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
    formData.append("modTime", String(params.modTime ?? Math.floor(Date.now() / 1000)));
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

/** 文件操作结果（不通过抛错表示失败） */
export type FsOpResult = { ok: true } | { ok: false; error: string };

export async function pathExists(path: string): Promise<boolean> {
    const response = await fetchSyncPost("/api/file/readDir", { path });
    return response.code === 0 && Array.isArray(response.data);
}

export async function writeTempFile(data: Uint8Array, path: string): Promise<FsOpResult> {
    console.log(`Writing temporary file: ${path}, data size: ${data.length} bytes`);

    // Uint8Array.buffer 类型为 ArrayBufferLike，与 BlobPart 定义不兼容，运行时作为 Blob 片段合法
    const blob = new Blob([data as BlobPart], { type: "application/octet-stream" });
    const fileName = path.split("/").pop() || "temp_file";
    console.log(`putFile: file=${fileName}, path=${path}`);

    const result = await putFile({
        path,
        isDir: false,
        file: blob,
    });

    console.log(`Write temporary file response: code=${result.code}`);

    if (result.code !== 0) {
        console.error(`Failed to write temporary file: ${result.msg}`);
        return { ok: false, error: `Failed to write temporary file: ${result.msg}` };
    }

    console.log(`Temporary file written successfully: ${path}`);
    return { ok: true };
}

export async function unzipFile(zipPath: string, extractPath: string): Promise<FsOpResult> {
    console.log(`Unzipping file: ${zipPath} -> ${extractPath}`);

    const response = await fetchSyncPost("/api/archive/unzip", {
        zipPath: zipPath,
        path: extractPath,
    });

    console.log(`Unzip file response: code=${response.code}`);

    if (response.code !== 0) {
        console.error(`Failed to unzip file: ${response.msg}`);
        return { ok: false, error: `Failed to unzip file: ${response.msg}` };
    }

    console.log(`File unzipped successfully: ${zipPath} -> ${extractPath}`);
    return { ok: true };
}

export async function removeFileOrDirectory(path: string): Promise<FsOpResult> {
    const response = await fetchSyncPost("/api/file/removeFile", { path });

    if (response.code !== 0) {
        console.warn(`Delete failed: ${path} - ${response.msg}`);
        return { ok: false, error: `Delete failed: ${response.msg}` };
    }

    console.log(`Delete successful: ${path}`);
    return { ok: true };
}

export async function cleanupTempFiles(paths: string[]): Promise<void> {
    for (const path of paths) {
        try {
            const response = await fetchSyncPost("/api/file/removeFile", { path });

            if (response.code !== 0) {
                console.warn(`Failed to clean up temporary file: ${path}`);
            }
        } catch (error) {
            console.warn(`Failed to clean up temporary file: ${path}`, error);
        }
    }
}

/** 删除目录（包括非空目录） */
export async function clearDirectory(dirPath: string): Promise<FsOpResult> {
    console.log(`Starting to delete directory: ${dirPath}`);

    if (!(await pathExists(dirPath))) {
        console.log(`Directory does not exist: ${dirPath}, no need to delete`);
        return { ok: true };
    }

    console.log(`Deleting directory: ${dirPath}`);
    const rm = await removeFileOrDirectory(dirPath);
    if (rm.ok === false) {
        console.error(`Failed to delete directory: ${dirPath}`, rm.error);
        return { ok: false, error: `Failed to delete directory: ${rm.error}` };
    }

    console.log(`Directory deleted successfully: ${dirPath}`);
    return { ok: true };
}

/**
 * 复制到安装路径（整个目录复制，globalCopyFiles 会保留源目录名）
 */
export async function copyToInstallPath(sourcePath: string, targetPath: string): Promise<FsOpResult> {
    console.log(`Starting to copy directory: ${sourcePath} -> ${targetPath}`);

    const workspaceDir = window.siyuan.config.system.workspaceDir || "";
    const absoluteSourcePath = workspaceDir ? `${workspaceDir}/${sourcePath}` : sourcePath;

    const lastSlashIndex = targetPath.lastIndexOf("/");
    const destDir = lastSlashIndex > 0 ? targetPath.substring(0, lastSlashIndex) : "";
    const targetDirName = lastSlashIndex > 0 ? targetPath.substring(lastSlashIndex + 1) : targetPath;

    const sourceDirName = sourcePath.split("/").pop() || sourcePath;

    console.log(`Workspace directory: ${workspaceDir}`);
    console.log(`Absolute source path: ${absoluteSourcePath}`);
    console.log(`Source directory name: ${sourceDirName}`);
    console.log(`Target parent directory: ${destDir}`);
    console.log(`Target directory name: ${targetDirName}`);

    const response = await fetchSyncPost("/api/file/globalCopyFiles", {
        srcs: [absoluteSourcePath],
        destDir: destDir,
    });

    console.log(`Copy directory response: code=${response.code}`, response);

    if (response.code !== 0) {
        return { ok: false, error: `Failed to copy directory: ${response.msg}` };
    }

    console.log(`Verifying: sourceDirName="${sourceDirName}", targetDirName="${targetDirName}"`);

    if (sourceDirName !== targetDirName) {
        console.warn("Warning: Source and target directory names do not match!");
        console.warn("This should not happen. The directory may have been copied with the wrong name.");
    }

    console.log(`Directory copy successful: ${sourcePath} -> ${targetPath}`);
    return { ok: true };
}

// /**
//  * 重命名目录
//  */
// export async function renameDirectory(oldPath: string, newPath: string): Promise<void> {
//     console.log(`Renaming directory: ${oldPath} -> ${newPath}`);
//
//     if (await pathExists(newPath)) {
//         console.log(`Target path already exists: ${newPath}, deleting it first`);
//         await clearDirectory(newPath);
//         console.log(`Cleared target path: ${newPath}`);
//     }
//
//     const responseData = await fetchSyncPost("/api/file/renameFile", {
//         path: oldPath,
//         newPath: newPath,
//     });
//
//     console.log(`Rename response: code=${responseData.code}`, responseData);
//
//     if (responseData.code !== 0) {
//         throw new Error(`Failed to rename directory: ${responseData.msg}`);
//     }
//
//     console.log(`Directory renamed successfully: ${oldPath} -> ${newPath}`);
// }
