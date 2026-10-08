/**
 * 本地已安装集市包
 *
 * 数据来自内核 `getInstalled*` 接口：包名、元数据版本、仓库来源（元数据的 `url` 字段）与安装状态。
 * 仓库来源是本插件各入口互相匹配的唯一依据（URL 输入、集市 PR、本地集市包页都归一到小写 `owner/repo`）。
 */

import { Constants, getFrontend } from "siyuan";
import { i18n } from "../infra/i18n";
import { packageLabelText } from "../infra/packageLabels";
import { fetchSyncPost } from "../infra/kernelClient";
import { repoKeyOf } from "../infra/repoKey";
import { PACKAGE_TYPE_BY_KERNEL_TYPE, type PackageType } from "./install";
import { sortPackagesByBazaarOrder } from "./packageSort";
import { KERNEL_PACKAGE_TYPES, type KernelPackageType } from "./packageTypes";
import type { Logger } from "../infra/logger";

/** 各类型的已安装包列表接口；是否需要 frontend 由 `kernelTypeNeedsFrontend` 判定 */
const INSTALLED_PACKAGES_API: Record<KernelPackageType, string> = {
    plugins: "/api/bazaar/getInstalledPlugin",
    themes: "/api/bazaar/getInstalledTheme",
    icons: "/api/bazaar/getInstalledIcon",
    widgets: "/api/bazaar/getInstalledWidget",
    templates: "/api/bazaar/getInstalledTemplate",
};

/** 类型归属的界面文案（与集市 PR 标签的文案共用同一份名称映射） */
export function kernelPackageTypeLabel(kernelType: string): string {
    return packageLabelText(PACKAGE_TYPE_BY_KERNEL_TYPE[kernelType] ?? kernelType);
}

/** 只有插件与主题需要按前端过滤：已安装列表、卸载与集市接口都是这条规则 */
export function kernelTypeNeedsFrontend(kernelType: KernelPackageType): boolean {
    return kernelType === "plugins" || kernelType === "themes";
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
    /** 元数据里的作者（`author` 字段）；无则空串 */
    author: string;
    /** 元数据里的描述（内核按当前语言挑好的 `preferredDesc`）；无则空串 */
    description: string;
    /** 安装日期（内核格式化的 `YYYY-MM-DD`）；无则空串 */
    hInstallDate: string;
    /** 元数据里的仓库地址（内核只保留 http/https 链接）；无则空串 */
    repoURL: string;
    /** 由 `repoURL` 规范化后的仓库键（小写 owner/repo）；无则空串 */
    repoKey: string;
    /** 包图标地址（内核给出的本地路径，带缓存版本）；本地包异常或无图标时为空串 */
    iconURL: string;
    /** 安装时间（Unix 毫秒） */
    installTime: number;
    /** 本地包内容最近一次变更的时间（Unix 毫秒） */
    updateTime: number;
    /** 插件是否启用；非插件恒为 false */
    enabled: boolean;
    /** 主题或图标是否为当前正在使用的；其它类型恒为 false */
    current: boolean;
    /** 内核给出的本地包异常原因，非空表示该包不可用 */
    invalidReason: string;
    /** 本地已安装的版本与当前思源是否不兼容；内核只对插件与主题下发 */
    incompatible: boolean;
    /** 需要升级思源才能启用或使用 */
    disallowInstall: boolean;
}

/** 思源集市「已下载」列表的排序配置键，存在 `window.siyuan.storage["local-bazaar"]` 里 */
const BAZAAR_SORT_KEY: Record<KernelPackageType, string> = {
    plugins: "downloadedPlugin",
    themes: "downloadedTheme",
    icons: "downloadedIcon",
    widgets: "downloadedWidget",
    templates: "downloadedTemplate",
};

/**
 * 读取思源集市「已下载」列表的排序方式
 *
 * 思源把这个偏好存在本地存储（`local-bazaar`）而非接口响应里，取值：0 默认、1 安装时间降序、
 * 2 安装时间升序、3 更新时间降序、4 更新时间升序、5 已启用优先、6 已禁用优先（后两者只对插件有意义）
 */
function bazaarSortValue(kernelType: KernelPackageType): string {
    const storage = window.siyuan.storage?.[Constants.LOCAL_BAZAAR] as Record<string, unknown> | undefined;
    const value = storage?.[BAZAAR_SORT_KEY[kernelType]];
    return typeof value === "string" ? value : "0";
}

/**
 * 按思源集市的排序配置排列某一类型的已安装包
 *
 * 排序规则见 `packageSort`，这里只负责读出该类型的排序配置并声明它是否支持「启用优先」。
 * 返回新数组，不改动传入的列表
 */
export function sortInstalledPackages(kernelType: KernelPackageType, packages: InstalledPackage[]): InstalledPackage[] {
    return sortPackagesByBazaarOrder(bazaarSortValue(kernelType), packages, {
        // 只有插件有启用状态
        supportsEnabledSort: kernelType === "plugins",
    });
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
        author: asString(raw.author),
        description: asString(raw.preferredDesc),
        hInstallDate: asString(raw.hInstallDate),
        repoURL,
        repoKey: repoKeyOf(repoURL) ?? "",
        iconURL: asString(raw.iconURL),
        installTime: typeof raw.installTime === "number" ? raw.installTime : 0,
        updateTime: typeof raw.updateTime === "number" ? raw.updateTime : 0,
        // 内核只对插件下发 enabled、只对主题与图标下发 current
        enabled: kernelType === "plugins" && raw.enabled === true,
        current: (kernelType === "themes" || kernelType === "icons") && raw.current === true,
        invalidReason: asString(raw.invalidReason),
        incompatible: raw.installedIncompatible === true,
        disallowInstall: raw.disallowInstall === true,
    };
}

/** 已安装集市包的读取结果；`null` 表示请求的类型全部读取失败，调用方按「加载失败」处理 */
export interface InstalledPackagesResult {
    packages: InstalledPackage[];
    /** 读取失败的类型（内核不可达或接口异常）；非空表示列表不完整，调用方应如实提示 */
    failedTypes: KernelPackageType[];
}

/**
 * 读取已安装集市包
 *
 * `types` 省略或为空数组都表示读取全部五类（内核的集市包变更通知偶尔不带类型，调用方不必自己兜底，
 * 也就不存在「传了空数组反而读到空列表」这种误用）。
 * 单类失败不影响其它类型，失败的类型记入 `failedTypes`，使调用方能区分「确实一个包都没装」
 * 与「有几类没读到」；**请求的类型全部失败**时返回 `null`
 */
export async function listInstalledPackages(
    log: Logger,
    types: readonly KernelPackageType[] = KERNEL_PACKAGE_TYPES,
): Promise<InstalledPackagesResult | null> {
    const requested: readonly KernelPackageType[] = types.length === 0 ? KERNEL_PACKAGE_TYPES : types;
    const responses = await Promise.all(requested.map((kernelType) => {
        return fetchSyncPost(
            INSTALLED_PACKAGES_API[kernelType],
            kernelTypeNeedsFrontend(kernelType) ? { frontend: getFrontend() } : {},
        );
    }));

    const packages: InstalledPackage[] = [];
    const failedTypes: KernelPackageType[] = [];
    for (let i = 0; i < requested.length; i++) {
        const kernelType = requested[i];
        const response = responses[i];
        const type = PACKAGE_TYPE_BY_KERNEL_TYPE[kernelType];
        const rawPackages = (response.data as { packages?: unknown } | null)?.packages;
        if (response.code !== 0 || type === undefined || !Array.isArray(rawPackages)) {
            failedTypes.push(kernelType);
            log.warn(i18n.installedLoadTypeFailed.replace("{type}", kernelPackageTypeLabel(kernelType)), response.msg);
            continue;
        }
        for (const item of rawPackages) {
            if (item && typeof item === "object") {
                packages.push(parseInstalledPackage(kernelType, type, item as Record<string, unknown>));
            }
        }
    }
    if (failedTypes.length === requested.length) {
        return null;
    }
    return { packages, failedTypes };
}
