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
    signal: AbortSignal,
    options?: { quietStatuses?: readonly number[] }
): Promise<T | null> {
    try {
        const response = await fetch(url, gitHubRequestInit(signal));
        if (!response.ok) {
            if (options?.quietStatuses?.includes(response.status)) {
                return null;
            }
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

/**
 * 获取指定 tag 的 Release；`version` 为空时先请求 `/releases/latest`。
 * 仅有预览版时该接口为 404；默认再回退为发布时间最新的已发布 Release。
 */
export async function getReleaseInfo(
    owner: string,
    repo: string,
    version: string,
    log: Logger,
    signal: AbortSignal,
    options?: { fallbackToNewestWhenNoLatest?: boolean }
): Promise<GitHubRelease | null> {
    if (version) {
        const url = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(version)}`;
        return fetchGitHubJson<GitHubRelease>(url, log, i18n.githubGetReleaseInfoFailed, signal);
    }
    const latestUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    // 仅有预览版 / 尚无正式版时 GitHub 返回 404，属预期
    const latest = await fetchGitHubJson<GitHubRelease>(
        latestUrl,
        log,
        i18n.githubGetReleaseInfoFailed,
        signal,
        { quietStatuses: [404] }
    );
    if (latest || signal.aborted) {
        return latest;
    }
    if (options?.fallbackToNewestWhenNoLatest === false) {
        return null;
    }
    const page = await listReleasesPage(owner, repo, log, signal, 1, 1);
    if (!page || page.rows.length === 0) {
        return null;
    }
    return getReleaseInfo(owner, repo, page.rows[0].tag, log, signal);
}

/** 正式 latest 缺失时，从已按发布时间降序排列的列表取最新 tag；无则 null */
export function fallbackLatestTagFromRows(rows: InstallReleaseRow[]): string | null {
    return rows[0]?.tag ?? null;
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

export interface ParsedPackageInfo {
    owner: string;
    repo: string;
    description: string;
    stars: number;
    updatedAtDisplay: string;
    /** 仓库 owner 头像 URL，来自 `GET /repos/{owner}/{repo}` 的 `owner.avatar_url` */
    ownerAvatarUrl: string;
    /** 规范化后的项目主页（仅 http / https），无则空串 */
    homepageUrl: string;
    /** 默认分支名（可能含 `/`），来自 API `default_branch`；用于 raw 资源 URL，无则空串 */
    defaultBranch: string;
    /** 许可证展示文案，优先 `license.spdx_id`，否则 `license.name`；无许可证时为空串 */
    licenseDisplay: string;
    /**
     * 输入为集市包仓库的 `.../releases/tag/{tag}` 时解析出的 tag；
     * 短格式、集市 Issue/PR、无该路径时为 null
     */
    urlTag: string | null;
}

/**
 * 构造 `raw.githubusercontent.com` 下仓库根目录文件的 URL。
 * `branch` 按路径段编码，以支持含 `/` 的分支名。
 */
export function githubRawRootFileUrl(owner: string, repo: string, branch: string, fileName: string): string {
    const branchPath = branch.split("/").map(encodeURIComponent).join("/");
    return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${branchPath}/${encodeURIComponent(fileName)}`;
}

/** 将 API 返回的 homepage 规范为可安全用于 `href` 的 URL */
function normalizeRepositoryHomepage(raw: unknown): string {
    if (typeof raw !== "string") {
        return "";
    }
    const t = raw.trim();
    if (!t) {
        return "";
    }
    try {
        const u = new URL(/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(t) ? t : `https://${t}`);
        if (u.protocol === "https:" || u.protocol === "http:") {
            return u.href;
        }
    } catch {
        return "";
    }
    return "";
}

/** 从 `GET /repos` 的 `license` 生成摘要展示用短文本 */
function licenseDisplayFromRepository(repoInfo: GitHubRepository): string {
    const lic = repoInfo.license;
    if (!lic || typeof lic !== "object") {
        return "";
    }
    const spdx = typeof lic.spdx_id === "string" ? lic.spdx_id.trim() : "";
    if (spdx && spdx !== "NOASSERTION") {
        return spdx;
    }
    const name = typeof lic.name === "string" ? lic.name.trim() : "";
    return name;
}

/**
 * 从 GitHub 仓库 URL 路径中解析 `/releases/tag/{tag}` 的 tag（支持 URL 编码；忽略末尾 `/`）。
 * 非该形态时返回 null。
 */
export function releaseTagFromGitHubPath(path: string): string | null {
    const match = path.match(/^\/releases\/tag\/(.+)$/i);
    if (!match) {
        return null;
    }
    let raw = match[1];
    while (raw.endsWith("/")) {
        raw = raw.slice(0, -1);
    }
    if (!raw) {
        return null;
    }
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

/**
 * 从用户输入解析 GitHub owner/repo：先识别 GitHub URL（仅 `siyuan-note/bazaar` 下 Issue/PR 从标题解析目标仓库），再识别 `owner/repo` 简写；最后用 API 校验仓库存在并返回摘要展示
 *
 * @param signal 新一次解析前 abort 时可取消未完成的 GitHub API 请求
 */
export async function parseOwnerRepo(
    input: string,
    log: Logger,
    signal: AbortSignal
): Promise<ParsedPackageInfo | null> {
    let owner: string;
    let repo: string;
    /** 仅集市包仓库 URL 上的 `/releases/tag/...`；集市 Issue/PR 与短格式为 null */
    let urlTag: string | null = null;
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
            // 从集市包仓库的 URL 中提取 owner/repo，以及可选的 Release tag
            if (repo.length >= 4 && repo.slice(-4).toLowerCase() === ".git") {
                repo = repo.slice(0, -4);
            }
            urlTag = releaseTagFromGitHubPath(githubUrlMatch[3] ?? "");
            if (urlTag) {
                log.info(`extract from GitHub URL: ${owner}/${repo}@${urlTag}`);
            } else {
                log.info(`extract from GitHub URL: ${owner}/${repo}`);
            }
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
    const updatedRaw = repoInfo.updated_at;
    let updatedAtDisplay = "";
    if (typeof updatedRaw === "string" && updatedRaw) {
        const d = new Date(updatedRaw);
        if (Number.isFinite(d.getTime())) {
            updatedAtDisplay = d.toLocaleDateString();
        }
    }
    const avatar =
        repoInfo.owner && typeof repoInfo.owner.avatar_url === "string" ? repoInfo.owner.avatar_url : "";
    const stars =
        typeof repoInfo.stargazers_count === "number" && Number.isFinite(repoInfo.stargazers_count)
            ? repoInfo.stargazers_count
            : 0;
    const defaultBranchRaw = repoInfo.default_branch;
    const defaultBranch =
        typeof defaultBranchRaw === "string" && defaultBranchRaw.trim() ? defaultBranchRaw.trim() : "";
    return {
        owner,
        repo,
        description: repoInfo.description ?? "",
        stars,
        updatedAtDisplay,
        ownerAvatarUrl: avatar,
        homepageUrl: normalizeRepositoryHomepage(repoInfo.homepage),
        defaultBranch,
        licenseDisplay: licenseDisplayFromRepository(repoInfo),
        urlTag,
    };
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
