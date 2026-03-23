/**
 * GitHub API：仓库与 Release、资源解析
 *
 * 类型来源：https://github.com/octokit/openapi-types.ts（基于 GitHub 的 OpenAPI 规范生成的 TypeScript 定义）
 */

import type { operations } from "@octokit/openapi-types";

/** GET /repos/{owner}/{repo} 的 200 响应体 */
export type GitHubRepository = operations["repos/get"]["responses"][200]["content"]["application/json"];

/** GET …/releases/latest 与 GET …/releases/tags/{tag} 的 200 响应体均为 release schema */
export type GitHubRelease = operations["repos/get-latest-release"]["responses"][200]["content"]["application/json"];

export type GitHubReleaseAsset = NonNullable<GitHubRelease["assets"]>[number];

async function fetchGitHubJson<T>(url: string, errorLabel: string): Promise<T | null> {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return (await response.json()) as T;
    } catch (error) {
        console.error(errorLabel, error);
        return null;
    }
}

export async function getRepositoryInfo(owner: string, repo: string): Promise<GitHubRepository | null> {
    const url = `https://api.github.com/repos/${owner}/${repo}`;
    return fetchGitHubJson<GitHubRepository>(url, "Failed to get repository information:");
}

export async function getReleaseInfo(owner: string, repo: string, version: string): Promise<GitHubRelease | null> {
    const url = version
        ? `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(version)}`
        : `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    return fetchGitHubJson<GitHubRelease>(url, "Failed to get Release information:");
}

/** 查找包文件 package.zip */
export function findPluginAsset(assets: GitHubRelease["assets"]): GitHubReleaseAsset | null {
    if (!assets || !Array.isArray(assets)) {
        return null;
    }

    const file = assets.find((asset) => asset.name === "package.zip"); // 大小写敏感，跟 bazaar 的逻辑一致

    return file ?? null;
}

/** 从下载 URL 中提取包名（仓库名） */
export function extractPackageNameFromUrl(url: string): string {
    const match = url.match(/github\.com\/[^\/]+\/([^\/]+)/);
    if (match && match[1]) {
        return match[1];
    }
    throw new Error("Unable to extract package name from URL");
}
