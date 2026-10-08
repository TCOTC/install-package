/**
 * 已安装集市包列表的纯操作（检索、排序、合并）
 *
 * 与 `installedPackages.ts` 分开：那个模块引了 `siyuan`（内核接口、本地存储），在 Node 下无法导入，
 * 放在一起会让这些规则失去单元测试。这里只声明用到的字段，因此可以用普通对象直接测，
 * 与 `packageSort.ts` 的做法一致
 */

import { normalizeRepoKey } from "../infra/repoKey";
import { KERNEL_PACKAGE_TYPES, type KernelPackageType } from "./packageTypes";

/** 列表项至少要有内核类型 */
interface IWithKernelType {
    kernelType: KernelPackageType;
}

/** 按仓库键检索时需要仓库键 */
interface IWithRepoKey extends IWithKernelType {
    repoKey: string;
}

/** 排序需要包名：包名在类型内唯一，类型 + 包名足以定序 */
interface IWithName extends IWithKernelType {
    name: string;
}

/** 一次「只读部分类型」的读取结果 */
interface IPartialResult<T> {
    packages: T[];
    failedTypes: readonly KernelPackageType[];
}

/** 按仓库键筛选已安装包；`repoKey` 大小写不限，结果可能有多项（实测一个仓库对应多个包） */
export function findInstalledByRepo<T extends IWithRepoKey>(packages: T[], repoKey: string): T[] {
    const key = normalizeRepoKey(repoKey);
    return key === "" ? [] : packages.filter((pkg) => pkg.repoKey === key);
}

/**
 * 按内核类型顺序稳定排序
 *
 * 同一仓库可能对应多个包（实测有插件与主题的元数据写着同一个仓库地址），各处取「第一个」时
 * 需要有确定的顺序；不能依赖接口返回的顺序与合并的先后
 */
export function sortByKernelType<T extends IWithName>(packages: T[]): T[] {
    return [...packages].sort((a, b) => {
        const byType = KERNEL_PACKAGE_TYPES.indexOf(a.kernelType) - KERNEL_PACKAGE_TYPES.indexOf(b.kernelType);
        if (byType !== 0) {
            return byType;
        }
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
}

/**
 * 本次读取里真正刷新到的类型
 *
 * 读失败的类型要从结果里排除：否则调用方会把它们的旧数据当成「已卸载」清掉
 */
export function refreshedTypes(
    types: readonly KernelPackageType[],
    failedTypes: readonly KernelPackageType[],
): Set<KernelPackageType> {
    const failed = new Set(failedTypes);
    return new Set(types.filter((type) => !failed.has(type)));
}

/**
 * 把「只读了部分类型」的结果合进已有列表
 *
 * 刷新到的类型整体换成新数据，其余类型（含读失败的类型）原样保留；
 * 顺序是先保留项后新数据，需要固定顺序时由调用方再排一次
 */
export function mergeInstalledByType<T extends IWithKernelType>(
    previous: T[],
    result: IPartialResult<T>,
    types: readonly KernelPackageType[],
): T[] {
    const affected = refreshedTypes(types, result.failedTypes);
    return [...previous.filter((pkg) => !affected.has(pkg.kernelType)), ...result.packages];
}
