/**
 * 思源集市（siyuan-note/bazaar）拉取请求接口
 *
 * 集市 PR 只把 `owner/repo` 追加到对应类型的 TXT 清单里，包本体仍在作者仓库的 Release 中；
 * PR Check 会校验该 Release，通过时打上 `ci-passed` 标签，并把本次校验的仓库与 tag 写进检查评论，
 * 因此「安装某条 PR 的包」= 读取检查评论拿仓库与 tag，再走常规的 Release 安装流程
 *
 * 类型来源：https://github.com/octokit/openapi-types.ts
 */

import type { operations } from "@octokit/openapi-types";
import { i18n } from "../infra/i18n";
import { fetchGitHubJson } from "./github";
import type { Logger } from "../infra/logger";

/** 集市仓库，PR 与检查评论都在这里 */
export const BAZAAR_REPO_OWNER = "siyuan-note";
export const BAZAAR_REPO_NAME = "bazaar";

/**
 * 列表分页用的 `per_page`，全链路须一致（否则 `page` 与全局偏移错位）。
 * 首页 1 次请求；滚动到底每次再请求 1 页并追加
 */
export const BAZAAR_PULLS_PER_PAGE = 30;

/** PR Check 通过时打的标签；只有带该标签的 PR 才允许安装 */
export const BAZAAR_CI_PASSED_LABEL = "ci-passed";

/** `pulls/list` 支持的 PR 状态；本页只用 open 与 closed 两种视图 */
export type BazaarPullState = "open" | "closed";

export interface BazaarPullLabel {
    name: string;
    /** 标签颜色，GitHub 返回的不带 `#` 的 6 位十六进制；异常时为空串 */
    color: string;
}

/** PR 列表中的一行（只保留界面需要的字段） */
export interface BazaarPullRow {
    number: number;
    title: string;
    authorLogin: string;
    /** 作者头像 URL；无则空串 */
    authorAvatarUrl: string;
    updatedAt: string;
    htmlUrl: string;
    /** 已关闭的 PR 是否为已合并 */
    merged: boolean;
    /** 当前状态；用于界面区分开放中与已关闭 */
    state: BazaarPullState;
    labels: BazaarPullLabel[];
}

type GitHubPullListItem = operations["pulls/list"]["responses"][200]["content"]["application/json"][number];
type GitHubIssueComment = operations["issues/list-comments"]["responses"][200]["content"]["application/json"][number];

/**
 * PR Check 写下的检查评论里的元数据标记
 *
 * 评论形如 `<!-- bazaar-check-result -->` 与 `<!-- bazaar-check-meta\n{JSON}\n-->`，
 * JSON 内没有 `-->`，因此从标记起取到第一个 `-->` 即整块 JSON
 */
const BAZAAR_CHECK_META_RE = /<!--\s*bazaar-check-meta\s*([\s\S]*?)-->/;

/** 集市 PR 标题的约定格式（bazaar/AGENTS.md）：`Add owner/repo` */
const BAZAAR_ADD_PULL_TITLE_RE = /^Add\s+([A-Za-z\d._-]+)\/([A-Za-z\d._-]+)\s*$/i;

/** PR 是否带 `ci-passed` 标签 */
export function isBazaarPullCIPassed(row: BazaarPullRow): boolean {
    return row.labels.some((label) => label.name === BAZAAR_CI_PASSED_LABEL);
}

/**
 * 从 PR Check 的检查评论中解析包仓库
 *
 * 评论里的 `fp.repo` 就是本次校验的包仓库；非新增包的 PR（如下架、弃用）没有 `fp`，返回 null。
 * 包版本一律由安装面板按最新 Release 解析，因此不使用 `fp.tag`
 */
export function parseBazaarCheckMeta(commentBody: string): string | null {
    const match = commentBody.match(BAZAAR_CHECK_META_RE);
    if (!match) {
        return null;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(match[1].trim());
    } catch {
        return null;
    }
    const fingerprint = (parsed as { fp?: unknown }).fp;
    if (!fingerprint || typeof fingerprint !== "object") {
        return null;
    }
    const repo = (fingerprint as { repo?: unknown }).repo;
    if (typeof repo !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(repo.trim())) {
        return null;
    }
    return repo.trim();
}

/**
 * 从集市 PR 标题解析包仓库；非「新增包」的标题（如下架）返回 null
 *
 * 仅用作检查评论缺失时的兜底：标题是约定格式 `Add owner/repo`，不按标题猜测其它形态可避免装错仓库
 */
export function ownerRepoFromBazaarPullTitle(title: string): string | null {
    const match = title.trim().match(BAZAAR_ADD_PULL_TITLE_RE);
    return match ? `${match[1]}/${match[2]}` : null;
}

function toPullLabels(raw: GitHubPullListItem["labels"]): BazaarPullLabel[] {
    const labels: BazaarPullLabel[] = [];
    for (const item of raw ?? []) {
        // 列表接口可能直接给出标签名或给出完整对象，两种都要兼容
        if (typeof item === "string") {
            labels.push({ name: item, color: "" });
            continue;
        }
        const name = typeof item?.name === "string" ? item.name : "";
        if (!name) {
            continue;
        }
        labels.push({ name, color: typeof item.color === "string" ? item.color : "" });
    }
    return labels;
}

function toPullRow(pull: GitHubPullListItem): BazaarPullRow | null {
    if (typeof pull.number !== "number") {
        return null;
    }
    const user = pull.user;
    return {
        number: pull.number,
        title: typeof pull.title === "string" ? pull.title : "",
        authorLogin: typeof user?.login === "string" ? user.login : "",
        authorAvatarUrl: typeof user?.avatar_url === "string" ? user.avatar_url : "",
        updatedAt: typeof pull.updated_at === "string" ? pull.updated_at : "",
        htmlUrl: typeof pull.html_url === "string" ? pull.html_url : "",
        merged: pull.merged_at !== null && pull.merged_at !== undefined,
        state: pull.state === "closed" ? "closed" : "open",
        labels: toPullLabels(pull.labels),
    };
}

/**
 * 拉取一页集市 PR（含已关闭）
 *
 * @returns 请求失败时为 null；成功时为该页的 PR 与「本页是否已满」（满则可能还有下一页）
 */
export async function listBazaarPulls(
    state: BazaarPullState,
    page: number,
    log: Logger,
    signal: AbortSignal,
    perPage = BAZAAR_PULLS_PER_PAGE,
): Promise<{ rows: BazaarPullRow[]; pageFull: boolean } | null> {
    const url = `https://api.github.com/repos/${BAZAAR_REPO_OWNER}/${BAZAAR_REPO_NAME}/pulls`
        + `?state=${state}&per_page=${perPage}&page=${page}`;
    const data = await fetchGitHubJson<GitHubPullListItem[]>(url, log, i18n.githubListBazaarPullsFailed, signal);
    if (data === null) {
        return null;
    }
    if (!Array.isArray(data)) {
        return { rows: [], pageFull: false };
    }
    const rows: BazaarPullRow[] = [];
    for (const pull of data) {
        const row = toPullRow(pull);
        if (row !== null) {
            rows.push(row);
        }
    }
    return { rows, pageFull: data.length >= perPage };
}

/**
 * 从某条 PR 的检查评论中读取包仓库
 *
 * 评论按时间升序返回，因此从最后往前找最新的那条检查评论；`per_page` 取 100，
 * 超过 100 条评论的 PR 找不到元数据时返回 null（由调用方回退为按标题解析）
 */
export async function getBazaarPullCommentRepo(
    pullNumber: number,
    log: Logger,
    signal: AbortSignal,
): Promise<string | null> {
    const url = `https://api.github.com/repos/${BAZAAR_REPO_OWNER}/${BAZAAR_REPO_NAME}/issues/${pullNumber}/comments?per_page=100`;
    const comments = await fetchGitHubJson<GitHubIssueComment[]>(url, log, i18n.githubGetPullCommentsFailed, signal);
    if (!Array.isArray(comments)) {
        return null;
    }
    for (let i = comments.length - 1; i >= 0; i--) {
        const body = comments[i]?.body;
        if (typeof body !== "string") {
            continue;
        }
        const repo = parseBazaarCheckMeta(body);
        if (repo !== null) {
            return repo;
        }
    }
    return null;
}
