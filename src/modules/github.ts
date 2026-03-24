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

const SHORT_FORMAT_RE = /^([^/\s]+)\/([^/\s]+)$/; // 短格式：`owner/repo`
const GITHUB_REPO_URL_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/?#]+)/i; // GitHub URL 格式：`https://github.com/owner/repo`
const GITHUB_ISSUE_OR_PULL_URL_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:pull|issues)\/(\d+)/i; // GitHub PR / Issue URL：`.../pull/N` 或 `.../issues/N`
const BAZAAR_PR_TITLE_RE = /([^/\s]+)\/([^/\s]+)/; // bazaar PR 标题：匹配首个 `owner/repo` 形式

async function getGitHubIssueTitle(
    owner: string,
    repo: string,
    issueNumber: number,
    signal?: AbortSignal
): Promise<string | null> {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
    const data = await fetchGitHubJson<GitHubIssue>(url, "Failed to get GitHub issue:", signal);
    console.log(`get GitHub issue:`, url, data);
    return data?.title ?? null;
}

/**
 * 从用户输入解析 GitHub owner/repo：完整仓库 URL、owner/repo 简写，或 Issue / PR 链接（从标题中解析首个 owner/repo）
 *
 * @param signal 可选；新一次解析前 abort 时可取消未完成的 GitHub API 请求
 */
export async function parseOwnerRepo(
    input: string,
    signal?: AbortSignal
): Promise<{ owner: string; repo: string } | null> {
    const trimmed = input.trim();

    const issueOrPullMatch = trimmed.match(GITHUB_ISSUE_OR_PULL_URL_RE);
    if (issueOrPullMatch) {
        const ghOwner = issueOrPullMatch[1];
        const ghRepo = issueOrPullMatch[2];
        const issueNumber = parseInt(issueOrPullMatch[3], 10);
        if (!Number.isFinite(issueNumber)) {
            return null;
        }
        const issueTitle = await getGitHubIssueTitle(ghOwner, ghRepo, issueNumber, signal);
        if (!issueTitle) {
            return null;
        }
        const titleMatch = issueTitle.match(BAZAAR_PR_TITLE_RE);
        if (!titleMatch) {
            console.error("Issue/PR title has no owner/repo segment:", issueTitle);
            return null;
        }
        const owner = titleMatch[1];
        const repo = titleMatch[2];
        console.log(`extract from bazaar issue/PR title: ${owner}/${repo}`);
        return { owner, repo };
    }

    const githubUrlMatch = trimmed.match(GITHUB_REPO_URL_RE);
    if (githubUrlMatch) {
        const owner = githubUrlMatch[1];
        let repo = githubUrlMatch[2];
        if (repo.length >= 4 && repo.slice(-4).toLowerCase() === ".git") {
            repo = repo.slice(0, -4);
        }
        console.log(`extract from GitHub URL: ${owner}/${repo}`);
        return { owner, repo };
    }

    const shortFormatMatch = trimmed.match(SHORT_FORMAT_RE);
    if (shortFormatMatch) {
        const owner = shortFormatMatch[1];
        const repo = shortFormatMatch[2];
        console.log(`extract from short format: ${owner}/${repo}`);
        return { owner, repo };
    }

    return null;
}
