/**
 * 内核推送的集市包变更（`ws-main`）
 *
 * 内核在集市包落盘或删除之后只推两条通知，都不是「集市包变更」专用事件：
 * - `bazaarChanged`：安装、更新、卸载**都会**推（`kernel/model/bazaar.go` 的 `pushBazaarChanged`），
 *   载荷是受影响的类型名数组（如 `["themes"]`）。它有安装与卸载之分，但**没有包名**
 * - `reloadPlugin`：插件被卸载时额外推一次，`uninstallPlugins` 是**被卸载的包名**；
 *   同一载荷里的 `unloadPlugins` 是**禁用**（含全局关闭插件开关、插件被禁用），不能当成卸载
 *
 * 类型名用于把刷新限制在受影响的类型上；包名只对插件存在，用于把已卸载的行立刻摘掉
 */

import { isKernelPackageType, KERNEL_PACKAGE_TYPES, type KernelPackageType } from "./packageTypes";

/** 一次集市包变更的影响范围 */
export interface PackageChange {
    /** 受影响的类型；空数组表示内核未指明类型，调用方按全部类型处理 */
    types: KernelPackageType[];
    /** 内核确认已卸载的插件包名；只有插件能给到名字，其它类型恒为空 */
    removedPlugins: string[];
}

/** 取出载荷里的包名数组；非字符串与空串一律丢弃，重复项合并 */
function packageNames(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(new Set(value.filter((name): name is string => typeof name === "string" && name !== "")));
}

/** 取出载荷里的类型名；非法取值丢弃，结果回到内核的类型顺序 */
function packageTypes(value: unknown): KernelPackageType[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const types = new Set(value.filter(isKernelPackageType));
    return KERNEL_PACKAGE_TYPES.filter((type) => types.has(type));
}

/**
 * 解析一条 `ws-main` 载荷
 *
 * 返回 `null` 表示不是集市包变更（`ws-main` 上还有大量其它通知），调用方直接忽略
 */
export function parsePackageChange(detail: unknown): PackageChange | null {
    if (typeof detail !== "object" || detail === null) {
        return null;
    }
    const { cmd, data } = detail as { cmd?: unknown; data?: unknown };
    if (cmd === "bazaarChanged") {
        // 载荷里的类型可能缺失或全是非法值，此时按「类型未指明」交给调用方决定刷新范围
        return { types: packageTypes(data), removedPlugins: [] };
    }
    if (cmd !== "reloadPlugin") {
        return null;
    }
    const removedPlugins = packageNames((data as { uninstallPlugins?: unknown } | null | undefined)?.uninstallPlugins);
    if (removedPlugins.length === 0) {
        // 启用、禁用、插件代码热重载都会推 `reloadPlugin`，那些不影响已安装集合
        return null;
    }
    // 卸载插件时 `bazaarChanged` 也会到，这里再认一次是为了不依赖两条通知的到达顺序
    return { types: ["plugins"], removedPlugins };
}
