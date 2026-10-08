/**
 * 内核集市包的包类型名
 *
 * 与内核接口、集市清单、`bazaarChanged` 通知载荷共用同一份类型名（复数），
 * 数组顺序即页面上的分组顺序。
 *
 * 单独成一个**无任何导入**的模块：内核通知的解析、类型判定与排序都只依赖它，
 * 而 `installedPackages.ts` 引了 `siyuan`，在 Node 下无法导入（该包没有 exports 入口），
 * 放在一起会让这些纯逻辑也失去单元测试的能力
 */

/** 内核集市接口使用的包类型名（复数），顺序即页面分组顺序 */
export const KERNEL_PACKAGE_TYPES = ["plugins", "themes", "icons", "widgets", "templates"] as const;

export type KernelPackageType = (typeof KERNEL_PACKAGE_TYPES)[number];

/** 外部数据（内核通知载荷）里的类型名判定 */
export function isKernelPackageType(value: unknown): value is KernelPackageType {
    return typeof value === "string" && (KERNEL_PACKAGE_TYPES as readonly string[]).includes(value);
}
