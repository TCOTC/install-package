/**
 * GitHub API
 *
 * 类型来源：https://github.com/octokit/openapi-types.ts（基于 GitHub 的 OpenAPI 规范生成的 TypeScript 定义）
 */

import type { operations } from "@octokit/openapi-types";
import { i18n } from "../infra/i18n";
import { getGitHubToken } from "../settings/setting";
import { showGitHubAuthNotice } from "./githubNotice";
import type { Logger } from "../ui/logger";

/**
 * 列表分页用的 `per_page`，全链路须一致（否则 `page` 与全局偏移错位）。
 * 首页 1 次请求；滚动到底每次再请求 1 页并追加。
 */
export const GITHUB_RELEASES_PER_PAGE = 30;

/** 仓库 Release 列表中的一行（用于版本下拉，按发布时间排序） */
export interface InstallReleaseRow {
    tag: string;
    publishedAt: string;
    prerelease: boolean;
}

export function sortInstallReleaseRowsByPublishedDesc(rows: InstallReleaseRow[]): void {
    rows.sort((a, b) => {
        const ta = Date.parse(a.publishedAt);
        const tb = Date.parse(b.publishedAt);
        if (Number.isFinite(tb) && Number.isFinite(ta)) {
            return tb - ta;
        }
        return 0;
    });
}

/** 合并多页结果并按发布时间降序；同 tag 保留先出现的条目 */
export function mergeInstallReleasePages(existing: InstallReleaseRow[], page: InstallReleaseRow[]): InstallReleaseRow[] {
    const map = new Map<string, InstallReleaseRow>();
    for (const r of existing) {
        map.set(r.tag, r);
    }
    for (const r of page) {
        if (!map.has(r.tag)) {
            map.set(r.tag, r);
        }
    }
    const merged = Array.from(map.values());
    sortInstallReleaseRowsByPublishedDesc(merged);
    return merged;
}

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
            let error = response.statusText;
            if (response.status === 403) {
                const quota = await fetchGitHubRateLimit(signal);
                if (quota) {
                    error = `GitHub rate limit: ${quota.remaining}/${quota.limit}`;
                } else {
                    error = "GitHub rate limit unavailable";
                }
            }
            showGitHubAuthNotice(response.status);
            throw new Error(`HTTP ${response.status}: ${error}`);
        }
        return (await response.json()) as T;
    } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) {
            log.warn(errorLabel, error);
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

/** 拉取单页已发布 Release（不含草稿）；`pageFull` 依据 API 返回的原始数组长度是否达到 `perPage` */
export async function listReleasesPage(
    owner: string,
    repo: string,
    log: Logger,
    signal: AbortSignal,
    page: number,
    perPage = GITHUB_RELEASES_PER_PAGE
): Promise<{ rows: InstallReleaseRow[]; pageFull: boolean } | null> {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=${perPage}&page=${page}`;
    const data = await fetchGitHubJson<GitHubRelease[]>(url, log, i18n.githubListReleasesFailed, signal);
    if (signal.aborted) {
        return null;
    }
    if (!data || !Array.isArray(data)) {
        return { rows: [], pageFull: false };
    }
    const pageFull = data.length >= perPage;
    const rows = data
        .filter((r) => r && !r.draft && typeof r.tag_name === "string")
        .map((r) => ({
            tag: r.tag_name,
            publishedAt: typeof r.published_at === "string" ? r.published_at : "",
            prerelease: r.prerelease === true,
        }));
    sortInstallReleaseRowsByPublishedDesc(rows);
    return { rows, pageFull };
}

/** 列出首页已发布 Release（不含草稿）；默认 `per_page` 与 `GITHUB_RELEASES_PER_PAGE` 一致 */
export async function listReleases(
    owner: string,
    repo: string,
    log: Logger,
    signal: AbortSignal,
    perPage = GITHUB_RELEASES_PER_PAGE
): Promise<InstallReleaseRow[]> {
    const result = await listReleasesPage(owner, repo, log, signal, 1, perPage);
    if (result === null) {
        return [];
    }
    return result.rows;
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
                log.warn("Issue/PR URL has no issue/pull number:", input);
                return null;
            }
            const issueNumber = parseInt(issueNumberMatch[1], 10);
            if (!Number.isFinite(issueNumber)) {
                log.warn("Issue/PR number is not a number:", issueNumber);
                return null;
            }
            const issueTitle = await getGitHubIssueTitle(owner, repo, issueNumber, log, signal);
            if (!issueTitle) {
                if (signal.aborted) {
                    return null;
                }
                log.warn("Issue/PR title not found for #:", issueNumber);
                return null;
            }
            const titleMatch = issueTitle.match(/([^/\s]+)\/([^/\s]+)/); // bazaar PR 标题：匹配首个 `owner/repo` 片段
            if (!titleMatch) {
                log.warn("Issue/PR title has no owner/repo segment:", issueTitle);
                return null;
            }
            owner = titleMatch[1];
            repo = titleMatch[2];
            log.info(`extract from bazaar issue/PR title: ${owner}/${repo}`);
        } else {
            // 从集市包仓库的 URL 中提取 owner/repo
            if (repo.length >= 4 && repo.slice(-4).toLowerCase() === ".git") {
                repo = repo.slice(0, -4);
            }
            log.info(`extract from GitHub URL: ${owner}/${repo}`);
        }
    } else {
        // 从短格式中提取 owner/repo
        const shortFormatMatch = input.match(/^([^/\s]+)\/([^/\s]+)$/); // 短格式：`owner/repo`
        if (!shortFormatMatch) {
            return null;
        }
        owner = shortFormatMatch[1];
        repo = shortFormatMatch[2];
        log.info(`extract from short format: ${owner}/${repo}`);
    }

    const repoInfo = await getRepositoryInfo(owner, repo, log, signal);
    if (!repoInfo) {
        return null;
    }
    // 输出仓库摘要
    log.info("Repository:", repoInfo.full_name);
    log.info("Description:", repoInfo.description || "");
    log.info("Stars:", repoInfo.stargazers_count);
    log.info("Last updated:", new Date(repoInfo.updated_at).toLocaleDateString());
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
