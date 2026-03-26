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

/** GET /repos/{owner}/{repo}/issues/{issue_number} 的 200 响应体（含 PR，可通过 pull_request 区分） */
export type GitHubIssue = operations["issues/get"]["responses"][200]["content"]["application/json"];

async function fetchGitHubJson<T>(
    url: string,
    errorLabel: string,
    signal?: AbortSignal
): Promise<T | null> {
    try {
        const response = await fetch(url, signal ? { signal } : undefined);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return (await response.json()) as T;
    } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) {
            console.error(errorLabel, error);
        }
        return null;
    }
}

export async function getRepositoryInfo(
    owner: string,
    repo: string,
    signal?: AbortSignal
): Promise<GitHubRepository | null> {
    const url = `https://api.github.com/repos/${owner}/${repo}`;
    return fetchGitHubJson<GitHubRepository>(url, "Failed to get repository information:", signal);
}

export async function getReleaseInfo(owner: string, repo: string, version: string): Promise<GitHubRelease | null> {
    const url = version
        ? `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(version)}`
        : `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    return fetchGitHubJson<GitHubRelease>(url, "Failed to get Release information:");
}

async function getGitHubIssueTitle(
    owner: string,
    repo: string,
    issueNumber: number,
    signal?: AbortSignal
): Promise<string | null> {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
    const data = await fetchGitHubJson<GitHubIssue>(url, "Failed to get GitHub issue:", signal);
    return data?.title ?? null;
}

/**
 * 从用户输入解析 GitHub owner/repo：先识别 GitHub URL（仅 `siyuan-note/bazaar` 下 Issue/PR 从标题解析目标仓库），再识别 `owner/repo` 简写；最后用 API 校验仓库存在并输出摘要
 *
 * @param signal 可选；新一次解析前 abort 时可取消未完成的 GitHub API 请求
 */
export async function parseOwnerRepo(
    input: string,
    signal?: AbortSignal
): Promise<{ owner: string; repo: string } | null> {
    input = input.trim();

    let owner: string;
    let repo: string;
    const githubUrlMatch = input.match(/^https?:\/\/github\.com\/([^/]+)\/([^/?#]+)(\/[^?#]*)?/i); // GitHub 仓库 URL：`https://github.com/owner/repo` 及可选后续路径（不含 query/hash）
    if (githubUrlMatch) {
        owner = githubUrlMatch[1];
        repo = githubUrlMatch[2];
        if (owner.toLowerCase() === "siyuan-note" && repo.toLowerCase() === "bazaar") {
            // 从集市 PR 的标题中提取 owner/repo
            const issueNumberMatch = (githubUrlMatch[3] ?? "").match(/^\/(?:pull|issues)\/(\d+)/i);
            if (!issueNumberMatch) {
                console.error("Issue/PR URL has no issue/pull number:", input);
                return null;
            }
            const issueNumber = parseInt(issueNumberMatch[1], 10);
            if (!Number.isFinite(issueNumber)) {
                console.error("Issue/PR number is not a number:", issueNumber);
                return null;
            }
            const issueTitle = await getGitHubIssueTitle(owner, repo, issueNumber, signal);
            if (!issueTitle) {
                console.error("Issue/PR title not found:", issueTitle);
                return null;
            }
            const titleMatch = issueTitle.match(/([^/\s]+)\/([^/\s]+)/); // bazaar PR 标题：匹配首个 `owner/repo` 片段
            if (!titleMatch) {
                console.error("Issue/PR title has no owner/repo segment:", issueTitle);
                return null;
            }
            owner = titleMatch[1];
            repo = titleMatch[2];
            console.log(`extract from bazaar issue/PR title: ${owner}/${repo}`);
        } else {
            // 从集市包仓库的 URL 中提取 owner/repo
            if (repo.length >= 4 && repo.slice(-4).toLowerCase() === ".git") {
                repo = repo.slice(0, -4);
            }
            console.log(`extract from GitHub URL: ${owner}/${repo}`);
        }
    } else {
        // 从短格式中提取 owner/repo
        const shortFormatMatch = input.match(/^([^/\s]+)\/([^/\s]+)$/); // 短格式：`owner/repo`
        if (!shortFormatMatch) {
            return null;
        }
        owner = shortFormatMatch[1];
        repo = shortFormatMatch[2];
        console.log(`extract from short format: ${owner}/${repo}`);
    }

    const repoInfo = await getRepositoryInfo(owner, repo, signal);
    if (!repoInfo) {
        return null;
    }
    // 输出仓库摘要
    console.log("Repository:", repoInfo.full_name);
    console.log("Description:", repoInfo.description || "");
    console.log("Stars:", repoInfo.stargazers_count);
    console.log("Last updated:", new Date(repoInfo.updated_at).toLocaleDateString());
    return { owner, repo };
}

/** 查找包文件 package.zip */
export function findPackageZip(assets: GitHubRelease["assets"]): GitHubReleaseAsset | null {
    if (!assets || !Array.isArray(assets)) {
        return null;
    }
    // 大小写敏感，跟 bazaar 的逻辑一致
    return assets.find((asset) => asset.name === "package.zip") ?? null;
}

// TODO 包名不一定等于仓库名
/** 从下载 URL 中提取包名（仓库名）；没有匹配时返回 null */
export function extractPackageNameFromUrl(url: string): string | null {
    const match = url.match(/github\.com\/[^\/]+\/([^\/]+)/);
    if (match && match[1]) {
        return match[1];
    }
    return null;
}
