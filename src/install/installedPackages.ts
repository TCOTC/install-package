/**
 * 本地已安装集市包
 *
 * 数据来自内核 `getInstalled*` 接口：包名、元数据版本、仓库来源（元数据的 `url` 字段）与安装状态。
 * 仓库来源是本插件各入口互相匹配的唯一依据（URL 输入、集市 PR、本地集市包页都归一到小写 `owner/repo`）。
 */

import { getFrontend } from "siyuan";
import { i18n } from "../infra/i18n";
import { fetchSyncPost } from "../infra/kernelClient";
import { PACKAGE_TYPE_BY_KERNEL_TYPE, type PackageType } from "./install";
import type { Logger } from "../ui/logger";

/** 内核集市接口使用的包类型名（复数），顺序即页面分组顺序 */
export const KERNEL_PACKAGE_TYPES = ["plugins", "themes", "icons", "widgets", "templates"] as const;

export type KernelPackageType = (typeof KERNEL_PACKAGE_TYPES)[number];

/** 各类型的已安装包列表接口；只有插件与主题按前端过滤 */
const INSTALLED_PACKAGES_API: Record<KernelPackageType, string> = {
    plugins: "/api/bazaar/getInstalledPlugin",
    themes: "/api/bazaar/getInstalledTheme",
    icons: "/api/bazaar/getInstalledIcon",
    widgets: "/api/bazaar/getInstalledWidget",
    templates: "/api/bazaar/getInstalledTemplate",
};

/** 类型归属的界面文案（与集市 PR 页的标签文案共用） */
const PACKAGE_TYPE_LABEL: Record<string, () => string> = {
    plugins: () => i18n.bazaarPrLabelPlugin,
    themes: () => i18n.bazaarPrLabelTheme,
    icons: () => i18n.bazaarPrLabelIcon,
    widgets: () => i18n.bazaarPrLabelWidget,
    templates: () => i18n.bazaarPrLabelTemplate,
};

/** 内核包类型名的界面文案；未知类型原样返回 */
export function kernelPackageTypeLabel(kernelType: string): string {
    return PACKAGE_TYPE_LABEL[kernelType]?.() ?? kernelType;
}

export interface InstalledPackage {
    /** 内核包类型（复数） */
    kernelType: KernelPackageType;
    /** 本插件的包类型 */
    type: PackageType;
    /** 包名，等同于安装目录名 */
    name: string;
    /** 当前语言下的展示名，缺失时回落到包名 */
    displayName: string;
    /** 元数据里的版本 */
    version: string;
    /** 元数据里的仓库地址（内核只保留 http/https 链接）；无则空串 */
    repoURL: string;
    /** 由 `repoURL` 规范化后的仓库键（小写 owner/repo）；无则空串 */
    repoKey: string;
    /** 包图标地址（内核给出的本地路径，带缓存版本）；本地包异常或无图标时为空串 */
    iconURL: string;
    /** 安装时间（Unix 毫秒） */
    installTime: number;
    /** 插件是否启用；非插件恒为 false */
    enabled: boolean;
    /** 主题或图标是否为当前正在使用的；其它类型恒为 false */
    current: boolean;
    /** 内核给出的本地包异常原因，非空表示该包不可用 */
    invalidReason: string;
}

/**
 * 把仓库地址规范化为小写 `owner/repo`
 *
 * 用 `URL` 解析而非正则，query、`#`、尾随 `/`、冗余斜杠一并交给它；`.git` 后缀手动去掉。
 * 外部数据可能非法（实测有包的 url 只有 owner），取不到仓库名时返回 null
 */
export function repoKeyOf(repoURL: string): string | null {
    let url: URL;
    try {
        url = new URL(repoURL);
    } catch {
        return null;
    }
    if (url.hostname.toLowerCase() !== "github.com") {
        return null;
    }
    // 空段一并滤掉，尾随斜杠与冗余斜杠都能得到同一结果
    const parts = url.pathname.split("/").filter((part) => part !== "");
    if (parts.length < 2) {
        return null;
    }
    const owner = parts[0].toLowerCase();
    const repo = parts[1].replace(/\.git$/i, "").toLowerCase();
    return owner !== "" && repo !== "" ? `${owner}/${repo}` : null;
}

/** 由解析出的 owner / repo 得到仓库键；两侧必须都小写化，元数据里的仓库地址大小写并不统一 */
export function repoKeyFromOwnerRepo(owner: string, repo: string): string {
    return `${owner}/${repo}`.trim().toLowerCase();
}

/** 按仓库键筛选已安装包；`repoKey` 须为小写形式，结果可能有多项（实测一个仓库对应多个包） */
export function findInstalledByRepo(packages: InstalledPackage[], repoKey: string): InstalledPackage[] {
    const key = repoKey.trim().toLowerCase();
    return key === "" ? [] : packages.filter((pkg) => pkg.repoKey === key);
}

function asString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

/** 内核返回的单条已安装包 → 本插件的结构；字段缺失或类型异常时取缺省值 */
function parseInstalledPackage(
    kernelType: KernelPackageType,
    type: PackageType,
    raw: Record<string, unknown>,
): InstalledPackage {
    const name = asString(raw.name);
    const repoURL = asString(raw.repoURL);
    const preferredName = asString(raw.preferredName).trim();
    return {
        kernelType,
        type,
        name,
        displayName: preferredName !== "" ? preferredName : name,
        version: asString(raw.version),
        repoURL,
        repoKey: repoKeyOf(repoURL) ?? "",
        iconURL: asString(raw.iconURL),
        installTime: typeof raw.installTime === "number" ? raw.installTime : 0,
        // 内核只对插件下发 enabled、只对主题与图标下发 current
        enabled: kernelType === "plugins" && raw.enabled === true,
        current: (kernelType === "themes" || kernelType === "icons") && raw.current === true,
        invalidReason: asString(raw.invalidReason),
    };
}

/**
 * 读取全部已安装集市包
 *
 * 五类并发请求：单类失败只写一行日志并跳过，不影响其它类型；全部失败时返回 null，
 * 由调用方决定如何提示（检测类调用可静默降级）
 */
export async function listInstalledPackages(log: Logger): Promise<InstalledPackage[] | null> {
    const responses = await Promise.all(KERNEL_PACKAGE_TYPES.map((kernelType) => {
        const withFrontend = kernelType === "plugins" || kernelType === "themes";
        return fetchSyncPost(INSTALLED_PACKAGES_API[kernelType], withFrontend ? { frontend: getFrontend() } : {});
    }));

    const packages: InstalledPackage[] = [];
    let failedTypes = 0;
    for (let i = 0; i < KERNEL_PACKAGE_TYPES.length; i++) {
        const kernelType = KERNEL_PACKAGE_TYPES[i];
        const response = responses[i];
        const type = PACKAGE_TYPE_BY_KERNEL_TYPE[kernelType];
        const rawPackages = (response.data as { packages?: unknown } | null)?.packages;
        if (response.code !== 0 || type === undefined || !Array.isArray(rawPackages)) {
            failedTypes++;
            log.warn(i18n.installedLoadTypeFailed.replace("{type}", kernelPackageTypeLabel(kernelType)), response.msg);
            continue;
        }
        for (const item of rawPackages) {
            if (item && typeof item === "object") {
                packages.push(parseInstalledPackage(kernelType, type, item as Record<string, unknown>));
            }
        }
    }
    return failedTypes === KERNEL_PACKAGE_TYPES.length ? null : packages;
}
