/**
 * GitHub API：仓库与 Release、资源解析
 */

export async function getRepositoryInfo(owner: string, repo: string): Promise<any> {
    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Failed to get repository information:", error);
        return null;
    }
}

export async function getReleaseInfo(owner: string, repo: string, version: string): Promise<any> {
    try {
        let url: string;
        if (version) {
            url = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${version}`;
        } else {
            url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
        }

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Failed to get Release information:", error);
        return null;
    }
}

/** 查找包文件 — 只允许 package.zip */
export function findPluginAsset(assets: any[]): any {
    if (!assets || !Array.isArray(assets)) {
        return null;
    }

    const file = assets.find((asset) => asset.name.toLowerCase() === "package.zip");

    return file || null;
}

/** 从下载 URL 中提取包名（仓库名） */
export function extractPackageNameFromUrl(url: string): string {
    const match = url.match(/github\.com\/[^\/]+\/([^\/]+)/);
    if (match && match[1]) {
        return match[1];
    }
    throw new Error("Unable to extract package name from URL");
}
