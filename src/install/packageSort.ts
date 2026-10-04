/**
 * 按思源集市的「已下载」排序配置排列包
 *
 * 规则与思源集市页一致，取值含义见 `installedPackages.bazaarSortValue`：
 * 0 默认（沿用内核顺序）、1/2 安装时间降/升、3/4 更新时间降/升、5/6 已启用/已禁用优先。
 *
 * 5、6 只对插件有意义（其它类型没有启用状态），由调用方按 `supportsEnabledSort` 声明；
 * 取值超出已知范围时保持内核顺序，便于思源日后新增排序方式而不致错乱。
 *
 * 只依赖这几个字段，因此不引用 `InstalledPackage`、也不触碰 window，可直接测试
 */

/** 排序用到的字段；与 `InstalledPackage` 结构兼容 */
export interface SortablePackage {
    /** 安装时间（Unix 毫秒）；取不到时为 0 */
    installTime: number;
    /** 内容最近一次变更时间（Unix 毫秒）；取不到时为 0 */
    updateTime: number;
    /** 插件是否启用；非插件恒为 false */
    enabled: boolean;
}

/** 时间缺失的判定阈值：内核给的是毫秒时间戳，小于 1 视为没取到 */
const MISSING_TIME = 1;

/**
 * 按集市排序配置排列；返回新数组（取值 0 或未知时原样返回传入的数组）
 *
 * 并列时保持原相对顺序（用原下标兜底），使排序结果稳定
 */
export function sortPackagesByBazaarOrder<T extends SortablePackage>(
    sortValue: string,
    packages: T[],
    options: { supportsEnabledSort: boolean },
): T[] {
    let value = sortValue;
    if (!options.supportsEnabledSort && (value === "5" || value === "6")) {
        value = "0";
    }
    if (value === "0") {
        return packages;
    }
    const indexed = packages.map((pkg, index) => ({ pkg, index }));
    const byTime = (field: "installTime" | "updateTime", descending: boolean): T[] =>
        indexed
            .sort((a, b) => {
                const aTime = a.pkg[field];
                const bTime = b.pkg[field];
                // 没取到时间的排在后面
                if (aTime < MISSING_TIME && bTime < MISSING_TIME) {
                    return a.index - b.index;
                }
                if (aTime < MISSING_TIME) {
                    return 1;
                }
                if (bTime < MISSING_TIME) {
                    return -1;
                }
                return (descending ? bTime - aTime : aTime - bTime) || a.index - b.index;
            })
            .map((entry) => entry.pkg);
    switch (value) {
        case "1":
            return byTime("installTime", true);
        case "2":
            return byTime("installTime", false);
        case "3":
            return byTime("updateTime", true);
        case "4":
            return byTime("updateTime", false);
        case "5":
        case "6":
            return indexed
                .sort((a, b) => {
                    const aEnabled = a.pkg.enabled ? 1 : 0;
                    const bEnabled = b.pkg.enabled ? 1 : 0;
                    return (value === "5" ? bEnabled - aEnabled : aEnabled - bEnabled) || a.index - b.index;
                })
                .map((entry) => entry.pkg);
        default:
            // 取值超出已知范围（如后续思源新增排序方式）时保持内核顺序
            return packages;
    }
}
