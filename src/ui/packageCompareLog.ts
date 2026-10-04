/**
 * 把「本地已安装包 vs 线上仓库」的对比写进安装面板日志
 *
 * 触发时机由面板决定（Release 数据到齐、匹配结果变化、用户选定版本），这里只负责
 * 取文案、去重与拼行：同一组「仓库 + 版本 + 本地包」只输出一次，避免反复解析时刷屏
 */

import { i18n, type PluginI18n } from "../infra/i18n";
import type { Logger } from "../infra/logger";
import { kernelPackageTypeLabel, type InstalledPackage } from "../install/installedPackages";
import type { InstallReleaseRow, ParsedPackageInfo } from "../github/github";
import {
    buildPackageCompareRows,
    COMPARE_DASH,
    formatPackageCompareLog,
    type CompareRowKey,
} from "./packageCompare";

/** 行标签的文案键；键集与 `CompareRowKey` 一一对应，漏一个会在这里编译报错 */
const ROW_LABEL_KEYS: Record<CompareRowKey, keyof PluginI18n> = {
    name: "compareRowName",
    version: "compareRowVersion",
    type: "compareRowType",
    author: "compareRowAuthor",
    description: "compareRowDescription",
    repo: "compareRowRepo",
    installedAt: "compareRowInstalledAt",
    updatedAt: "compareRowUpdatedAt",
    publishedAt: "compareRowPublishedAt",
    zipUploadedAt: "compareRowZipUploadedAt",
    license: "compareRowLicense",
    stars: "compareRowStars",
};

export interface PackageCompareLogInput {
    /** 与当前仓库匹配到的本地集市包（已剔除插件自身）；没有匹配时为 undefined */
    local: InstalledPackage | undefined;
    /** 线上仓库信息；面板尚未解析成功时为 null */
    remote: ParsedPackageInfo | null;
    /** 面板当前选中的版本（Git Tag）；未选择时为空串 */
    version: string;
    /** 仓库最新 Release 的 tag；未知为 null */
    latestTag: string | null;
    /** 选中版本对应的 Release 行；不在当前列表里时为 null */
    selectedRelease: InstallReleaseRow | null;
}

export class PackageCompareLogger {
    /** 上一次输出的内容标识；空串表示还没有输出过（或当前无可对比对象） */
    private lastKey = "";

    constructor(private readonly logger: Logger) {}

    /**
     * 匹配到本地包时输出一段对比
     *
     * 没有匹配对象时只清掉标识：之后若重新匹配到同一个包（例如卸载后又装上），会重新输出一次
     */
    log(input: PackageCompareLogInput): void {
        const local = input.local;
        if (local === undefined) {
            this.lastKey = "";
            return;
        }
        const key = [
            local.kernelType,
            local.name,
            input.version,
            input.latestTag ?? "",
        ].join("|");
        if (key === this.lastKey) {
            return;
        }
        this.lastKey = key;
        const rows = buildPackageCompareRows(
            {
                local,
                remote: input.remote,
                localTypeLabel: kernelPackageTypeLabel(local.kernelType),
                version: input.version,
                latestTag: input.latestTag,
                selectedRelease: input.selectedRelease,
            },
            { latest: i18n.versionTagSuffixLatest, prerelease: i18n.versionTagSuffixPrerelease },
        );
        const labels = {} as Record<CompareRowKey, string>;
        for (const [rowKey, i18nKey] of Object.entries(ROW_LABEL_KEYS) as [CompareRowKey, keyof PluginI18n][]) {
            labels[rowKey] = i18n[i18nKey];
        }
        const lines = formatPackageCompareLog(rows, labels, { line: i18n.compareLogLine, dash: COMPARE_DASH });
        const title = i18n.compareLocalPackagesTitle.replace("{name}", local.displayName);
        // 一段对比作为一条日志，整体折行；日志区是 `white-space: pre-wrap`，因此换行会保留
        this.logger.info([title, ...lines].join("\n"));
    }
}
