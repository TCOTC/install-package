/**
 * 思源内核文件相关 API 封装
 */

import { fetchSyncPost, putFile } from "./fetchKernel";

export async function pathExists(path: string): Promise<boolean> {
    try {
        const response = await fetchSyncPost("/api/file/readDir", { path });
        return response.code === 0 && response.data && Array.isArray(response.data);
    } catch (error) {
        return false;
    }
}

export async function writeTempFile(data: Uint8Array, path: string): Promise<void> {
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
        throw new Error(`Failed to write temporary file: ${result.msg}`);
    }

    console.log(`Temporary file written successfully: ${path}`);
}

export async function unzipFile(zipPath: string, extractPath: string): Promise<void> {
    console.log(`Unzipping file: ${zipPath} -> ${extractPath}`);

    const response = await fetchSyncPost("/api/archive/unzip", {
        zipPath: zipPath,
        path: extractPath,
    });

    console.log(`Unzip file response: code=${response.code}`);

    if (response.code !== 0) {
        console.error(`Failed to unzip file: ${response.msg}`);
        throw new Error(`Failed to unzip file: ${response.msg}`);
    }

    console.log(`File unzipped successfully: ${zipPath} -> ${extractPath}`);
}

export async function removeFileOrDirectory(path: string): Promise<void> {
    try {
        const response = await fetchSyncPost("/api/file/removeFile", { path });

        if (response.code !== 0) {
            console.warn(`Delete failed: ${path} - ${response.msg}`);
            throw new Error(`Delete failed: ${response.msg}`);
        }

        console.log(`Delete successful: ${path}`);
    } catch (error) {
        console.error(`Failed to delete file/directory: ${path}`, error);
        throw error;
    }
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
export async function clearDirectory(dirPath: string): Promise<void> {
    try {
        console.log(`Starting to delete directory: ${dirPath}`);

        if (!(await pathExists(dirPath))) {
            console.log(`Directory does not exist: ${dirPath}, no need to delete`);
            return;
        }

        console.log(`Deleting directory: ${dirPath}`);
        await removeFileOrDirectory(dirPath);
        console.log(`Directory deleted successfully: ${dirPath}`);
    } catch (error) {
        console.error(`Failed to delete directory: ${dirPath}`, error);
        throw new Error(`Failed to delete directory: ${error.message}`);
    }
}

/**
 * 复制到安装路径（整个目录复制，globalCopyFiles 会保留源目录名）
 */
export async function copyToInstallPath(sourcePath: string, targetPath: string): Promise<void> {
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
        throw new Error(`Failed to copy directory: ${response.msg}`);
    }

    console.log(`Verifying: sourceDirName="${sourceDirName}", targetDirName="${targetDirName}"`);

    if (sourceDirName !== targetDirName) {
        console.warn("Warning: Source and target directory names do not match!");
        console.warn("This should not happen. The directory may have been copied with the wrong name.");
    }

    console.log(`Directory copy successful: ${sourcePath} -> ${targetPath}`);
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
