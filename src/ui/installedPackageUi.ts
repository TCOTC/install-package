/**
 * 已安装集市包界面的公共片段
 *
 * 「本地集市包」页与「本地集市包列表」菜单展示同一批数据（`InstalledPackage`），
 * 行标识、图标按钮、可用性判定、默认类型切换、空列表提示与状态行因此集中在这里，
 * 避免两个界面各写一份实现后在细节上走偏
 */

import { i18n } from "../infra/i18n";
import { kernelPackageTypeLabel, type InstalledPackage } from "../install/installedPackages";
import { KERNEL_PACKAGE_TYPES, type KernelPackageType } from "../install/packageTypes";

/** 行标识：内核类型 + 包名，不同目录下的同名包互不影响 */
export function rowKey(pkg: InstalledPackage): string {
    return `${pkg.kernelType}/${pkg.name}`;
}

/** 行尾与卡片的图标按钮；文案放在 aria-label 里，由思源的 `.ariaLabel` 提示显示 */
export function iconButton(icon: string, label: string, action: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "block__icon block__icon--show ariaLabel";
    button.dataset.action = action;
    button.setAttribute("aria-label", label);
    button.setAttribute("data-position", "north");
    button.innerHTML = `<svg><use xlink:href="#${icon}"></use></svg>`;
    return button;
}

/** 包是否可用：有仓库来源（可检查更新）且内核未报告本地包异常 */
export function isUsablePackage(pkg: InstalledPackage): boolean {
    return pkg.repoKey !== "" && pkg.invalidReason === "";
}

/** 当前类型一个包都没有而其它类型有时，自动切到第一个有内容的类型，避免打开就见到空列表 */
export function pickDefaultType(packages: InstalledPackage[], activeType: KernelPackageType): KernelPackageType {
    if (packages.some((pkg) => pkg.kernelType === activeType)) {
        return activeType;
    }
    return KERNEL_PACKAGE_TYPES.find((kernelType) =>
        packages.some((pkg) => pkg.kernelType === kernelType)
    ) ?? activeType;
}

/** 空列表提示：整个工作空间没有已安装包，或该类型下没有 */
export function emptyPackagesText(packages: InstalledPackage[], activeType: KernelPackageType): string {
    if (packages.length === 0) {
        return i18n.installedEmpty;
    }
    return packages.some((pkg) => pkg.kernelType === activeType)
        ? ""
        : i18n.installedEmptyType.replace("{type}", kernelPackageTypeLabel(activeType));
}

/**
 * 部分类型读取失败时的说明文案；无失败类型时返回空串
 *
 * 名用 `/` 连接：中文习惯的顿号与英文的逗号不同，而这一行不能靠硬编码分隔符区分语言，
 * `/` 在两种语言下都无歧义
 */
export function partialFailedText(failedTypes: KernelPackageType[]): string {
    if (failedTypes.length === 0) {
        return "";
    }
    return i18n.installedLoadPartialFailed.replace(
        "{types}",
        failedTypes.map((kernelType) => kernelPackageTypeLabel(kernelType)).join("/"),
    );
}

/** 状态行：空文本时隐藏，错误时加错误色修饰类；元素不存在时静默（列表尚未建好） */
export function setStatusText(
    el: HTMLElement | undefined,
    text: string,
    isError: boolean,
    errorModifier: string,
): void {
    if (el === undefined) {
        return;
    }
    el.textContent = text;
    el.classList.toggle("fn__none", text === "");
    el.classList.toggle(errorModifier, isError);
}
