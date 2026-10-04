/**
 * 「对比本地包信息」的两列取值与日志行
 *
 * 本地一侧来自内核 `getInstalled*`，线上侧来自面板已经解析好的仓库摘要与 Release 列表，
 * 因此对比不需要再发任何请求；两列都能取到才算真正「可以对比」，缺的一侧留空，
 * 由展示层换成占位符。
 *
 * 这里只做数据拼装：纯函数、无运行期导入、不读 i18n、不碰 DOM，因此可以在 Node 下直接单测；
 * 行的标签、占位符与分隔符由调用方给出（见 `packageCompareLog`）
 */

import type { InstallReleaseRow, ParsedPackageInfo } from "../github/github";
import type { InstalledPackage } from "../install/installedPackages";

/** 某一侧没有该信息时的占位 */
export const COMPARE_DASH = "\u2014";

/** 行的稳定标识；标签文案由调用方按这个键给出 */
export type CompareRowKey =
    | "name"
    | "version"
    | "type"
    | "author"
    | "description"
    | "repo"
    | "installedAt"
    | "updatedAt"
    | "publishedAt"
    | "zipUploadedAt"
    | "license"
    | "stars";

export interface CompareRow {
    key: CompareRowKey;
    /** 本地已安装包的值；空串表示这一侧没有该信息 */
    local: string;
    /** 线上仓库的值；空串表示这一侧没有该信息 */
    remote: string;
}

/** 版本后缀文案（由对话框层用 i18n 给出） */
export interface CompareVersionSuffixes {
    /** 形如「（最新）」 */
    latest: string;
    /** 形如「（预发布）」 */
    prerelease: string;
}

export interface PackageCompareInput {
    /** 本地已安装包；面板已按仓库键匹配并剔除插件自身 */
    local: InstalledPackage;
    /** 线上仓库信息；面板尚未解析成功时为 null */
    remote: ParsedPackageInfo | null;
    /** 本地包类型的展示文案 */
    localTypeLabel: string;
    /** 面板当前选中的版本（Git Tag）；未选择时为空串 */
    version: string;
    /** 仓库最新 Release 的 tag；未知为 null */
    latestTag: string | null;
    /** 选中版本对应的 Release 行；不在当前列表里时为 null */
    selectedRelease: InstallReleaseRow | null;
}

/**
 * 本地时间戳（毫秒）→ 本地日期时间；无效或缺失时返回空串
 *
 * 与仓库摘要里的 Release 发布时间用同一套选项（含秒、24 小时制），
 * 避免同一面板里出现两种时间写法
 */
function formatTimestamp(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) {
        return "";
    }
    return new Date(ms).toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
}

/** ISO 8601 → 本地日期时间；无法解析时返回空串 */
function formatIso(iso: string): string {
    const time = Date.parse(iso);
    if (!Number.isFinite(time)) {
        return "";
    }
    return formatTimestamp(time);
}

/** 线上版本的展示值：选中的 tag 加上「（最新）」「（预发布）」后缀 */
function formatRemoteVersion(input: PackageCompareInput, suffixes: CompareVersionSuffixes): string {
    const version = input.version;
    if (version === "") {
        return "";
    }
    let out = version;
    if (input.latestTag !== null && version === input.latestTag) {
        out += suffixes.latest;
    }
    if (input.selectedRelease?.prerelease === true) {
        out += suffixes.prerelease;
    }
    return out;
}

/**
 * 生成对比对话框的两列数据
 *
 * 顺序即展示顺序：先是两侧都有的身份与版本，然后是本地独有的安装状态，
 * 最后是线上独有的许可证与星标
 */
export function buildPackageCompareRows(
    input: PackageCompareInput,
    suffixes: CompareVersionSuffixes,
): CompareRow[] {
    const local = input.local;
    const remote = input.remote;
    // 展示名与包名不同时补上包名，否则对不上安装目录名（同一仓库可能装出多个包）
    const localName = local.displayName !== local.name && local.name !== ""
        ? `${local.displayName} (${local.name})`
        : local.displayName;
    return [
        { key: "name", local: localName, remote: remote === null ? "" : remote.repo },
        { key: "version", local: local.version, remote: formatRemoteVersion(input, suffixes) },
        { key: "type", local: input.localTypeLabel, remote: "" },
        { key: "author", local: local.author, remote: remote === null ? "" : remote.owner },
        { key: "description", local: local.description, remote: remote === null ? "" : remote.description },
        {
            key: "repo",
            local: local.repoURL,
            remote: remote === null ? "" : `https://github.com/${remote.owner}/${remote.repo}`,
        },
        { key: "installedAt", local: local.hInstallDate, remote: "" },
        { key: "updatedAt", local: formatTimestamp(local.updateTime), remote: "" },
        {
            key: "publishedAt",
            local: "",
            remote: input.selectedRelease === null ? "" : formatIso(input.selectedRelease.publishedAt),
        },
        {
            key: "zipUploadedAt",
            local: "",
            remote: input.selectedRelease === null ? "" : formatIso(input.selectedRelease.packageZipAt),
        },
        { key: "license", local: "", remote: remote === null ? "" : remote.licenseDisplay },
        { key: "stars", local: "", remote: remote === null ? "" : String(remote.stars) },
    ];
}

/** 日志行的格式：每行的模板与占位符都由调用方给出，模块内不参与文案决策 */
export interface CompareLogFormat {
    /** 单行模板，含 `{label}` / `{local}` / `{remote}` 三个占位符 */
    line: string;
    /** 某一侧没有该信息时的占位文本 */
    dash: string;
}

/**
 * 把对比行渲染成日志文本行
 *
 * 两侧都有值的行是真正可比的信息；只有一侧有值时另一侧显示占位符，也一并输出，
 * 便于一眼看出「本地有、线上没有」这类差异。缩进由这里给出，调用方直接逐行写入日志
 */
export function formatPackageCompareLog(
    rows: CompareRow[],
    labels: Record<CompareRowKey, string>,
    format: CompareLogFormat,
): string[] {
    const cell = (value: string): string => value === "" ? format.dash : value;
    // 一次扫描替换全部占位符：逐个 `replace` 会让「取值里恰好含有占位符文本」被二次替换
    return rows.map((row) => "  " + format.line.replace(
        /\{(label|local|remote)\}/g,
        (_match, name: string) => name === "label"
            ? labels[row.key]
            : cell(name === "local" ? row.local : row.remote),
    ));
}
