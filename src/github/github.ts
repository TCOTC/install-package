/**
 * GitHub API
 *
 * 类型来源：https://github.com/octokit/openapi-types.ts（基于 GitHub 的 OpenAPI 规范生成的 TypeScript 定义）
 */

import type { operations } from "@octokit/openapi-types";
import { i18n } from "../infra/i18n";
import { getGitHubToken } from "../settings/setting";
import { message } from "../infra/message";
import { showGitHubAuthNotice } from "./githubNotice";
import type { Logger } from "../types";

export type GitHubApiErrorInfo = { status: number; apiMessage?: string };
type GitHubRateLimitResponse = operations["rate-limit/get"]["responses"][200]["content"]["application/json"];

async function fetchGitHubRateLimit(signal: AbortSignal): Promise<{
    limit: number;
    remaining: number;
    reset: number;
} | null> {
    try {
        const response = await fetch("https://api.github.com/rate_limit", gitHubRequestInit(signal));
        if (!response.ok) {
            return null;
        }
        const payload = (await response.json()) as GitHubRateLimitResponse;
        const rate = payload.rate;
        if (!rate) {
            return null;
        }
        return {
            limit: typeof rate.limit === "number" ? rate.limit : 0,
            remaining: typeof rate.remaining === "number" ? rate.remaining : 0,
            reset: typeof rate.reset === "number" ? rate.reset : 0,
        };
    } catch {
        return null;
    }
}

function gitHubRequestInit(signal: AbortSignal): RequestInit {
    const headers: HeadersInit = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    };
    const githubToken = getGitHubToken();
    if (githubToken) {
        headers.Authorization = `Bearer ${githubToken}`;
    }
    return { headers, signal };
}

/** GET /repos/{owner}/{repo} 的 200 响应体 */
export type GitHubRepository = operations["repos/get"]["responses"][200]["content"]["application/json"];

/** GET …/releases/latest 与 GET …/releases/tags/{tag} 的 200 响应体均为 release schema */
export type GitHubRelease = operations["repos/get-latest-release"]["responses"][200]["content"]["application/json"];

export type GitHubReleaseAsset = NonNullable<GitHubRelease["assets"]>[number];

/** GET /repos/{owner}/{repo}/issues/{issue_number} 的 200 响应体（含 PR，可通过 pull_request 区分） */
export type GitHubIssue = operations["issues/get"]["responses"][200]["content"]["application/json"];

async function fetchGitHubJson<T>(
    url: string,
    log: Logger,
    errorLabel: string,
    signal: AbortSignal
): Promise<T | null> {
    try {
        const response = await fetch(url, gitHubRequestInit(signal));
        if (!response.ok) {
            let error: string;
            if (response.status === 403) {
                const quota = await fetchGitHubRateLimit(signal);
                if (quota) {
                    error = `GitHub rate limit: ${quota.remaining}/${quota.limit}`;
                } else {
                    error = "GitHub rate limit unavailable";
                }
            }
            showGitHubAuthNotice(response.status);
            throw new Error(`HTTP ${response.status}: ${error ?? response.statusText}`);
        }
        return (await response.json()) as T;
    } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) {
            log(errorLabel, error);
            message(errorLabel + (error instanceof Error ? error.message : String(error)));
        }
        return null;
    }
}

export async function getRepositoryInfo(
    owner: string,
    repo: string,
    log: Logger,
    signal: AbortSignal
): Promise<GitHubRepository | null> {
    const url = `https://api.github.com/repos/${owner}/${repo}`;
    return fetchGitHubJson<GitHubRepository>(url, log, i18n.githubGetRepositoryInfoFailed, signal);
}

export async function getReleaseInfo(
    owner: string,
    repo: string,
    version: string,
    log: Logger,
    signal: AbortSignal
): Promise<GitHubRelease | null> {
    const url = version
        ? `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(version)}`
        : `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    return fetchGitHubJson<GitHubRelease>(url, log, i18n.githubGetReleaseInfoFailed, signal);
}

async function getGitHubIssueTitle(
    owner: string,
    repo: string,
    issueNumber: number,
    log: Logger,
    signal: AbortSignal
): Promise<string | null> {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
    const data = await fetchGitHubJson<GitHubIssue>(url, log, i18n.githubGetIssueFailed, signal);
    return data?.title ?? null;
}

/**
 * 从用户输入解析 GitHub owner/repo：先识别 GitHub URL（仅 `siyuan-note/bazaar` 下 Issue/PR 从标题解析目标仓库），再识别 `owner/repo` 简写；最后用 API 校验仓库存在并输出摘要
 *
 * @param signal 新一次解析前 abort 时可取消未完成的 GitHub API 请求
 */
export async function parseOwnerRepo(
    input: string,
    log: Logger,
    signal: AbortSignal
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
                log("Issue/PR URL has no issue/pull number:", input);
                return null;
            }
            const issueNumber = parseInt(issueNumberMatch[1], 10);
            if (!Number.isFinite(issueNumber)) {
                log("Issue/PR number is not a number:", issueNumber);
                return null;
            }
            const issueTitle = await getGitHubIssueTitle(owner, repo, issueNumber, log, signal);
            if (!issueTitle) {
                log("Issue/PR title not found:", issueTitle);
                return null;
            }
            const titleMatch = issueTitle.match(/([^/\s]+)\/([^/\s]+)/); // bazaar PR 标题：匹配首个 `owner/repo` 片段
            if (!titleMatch) {
                log("Issue/PR title has no owner/repo segment:", issueTitle);
                return null;
            }
            owner = titleMatch[1];
            repo = titleMatch[2];
            log(`extract from bazaar issue/PR title: ${owner}/${repo}`);
        } else {
            // 从集市包仓库的 URL 中提取 owner/repo
            if (repo.length >= 4 && repo.slice(-4).toLowerCase() === ".git") {
                repo = repo.slice(0, -4);
            }
            log(`extract from GitHub URL: ${owner}/${repo}`);
        }
    } else {
        // 从短格式中提取 owner/repo
        const shortFormatMatch = input.match(/^([^/\s]+)\/([^/\s]+)$/); // 短格式：`owner/repo`
        if (!shortFormatMatch) {
            return null;
        }
        owner = shortFormatMatch[1];
        repo = shortFormatMatch[2];
        log(`extract from short format: ${owner}/${repo}`);
    }

    const repoInfo = await getRepositoryInfo(owner, repo, log, signal);
    if (!repoInfo) {
        return null;
    }
    // 输出仓库摘要
    log("Repository:", repoInfo.full_name);
    log("Description:", repoInfo.description || "");
    log("Stars:", repoInfo.stargazers_count);
    log("Last updated:", new Date(repoInfo.updated_at).toLocaleDateString());
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
