/**
 * 插件自定义页签的打开与复用
 */

import { getAllTabs, openTab, type App, type Tab } from "siyuan";

export interface CustomTabOptions {
    app: App;
    /** 页签类型，必须等于 `plugin.name` 加 `addTab` 的 `type` */
    customId: string;
    icon: string;
    title: string;
}

/** 按类型取出已打开的自定义页签（顺序为布局中的先后） */
export function getOpenedCustomTabs(customId: string): Tab[] {
    return getAllTabs(customId);
}

/** 切到该页签并展开标题栏 */
export function focusCustomTab(tab: Tab): void {
    tab.parent.switchTab(tab.headElement);
    tab.parent.showHeading();
}

/**
 * 新建一个自定义页签，不查找、不复用已有页签
 *
 * 显式传 `openNewTab: true`：`openTab` 自身也有一条判重（`app/src/editor/util.ts` 的 `isSameCustomTab`），
 * 它按 `custom.data` 比较，而页签内的面板会把 `custom.data` 换成规范化后的对象，
 * 与这里传入的空对象不再相等，行为不可预期；置位后「新建还是复用」完全由本模块决定
 */
export function openNewCustomTab(options: CustomTabOptions): void {
    openTab({
        app: options.app,
        openNewTab: true,
        custom: {
            id: options.customId,
            icon: options.icon,
            title: options.title,
            data: {},
        },
    });
}

/**
 * 打开自定义页签；同类型的页签已经打开时切回它，不再新建
 */
export function openOrFocusCustomTab(options: CustomTabOptions): void {
    const opened = getOpenedCustomTabs(options.customId)[0];
    if (opened) {
        focusCustomTab(opened);
        return;
    }
    openNewCustomTab(options);
}

/**
 * 从已打开的同类页签中找出第一个可复用的，一并返回 `pick` 给出的目标对象；没有则返回 `null`
 *
 * 用于同一类型允许开多个页签的场景（如安装面板）：由调用方判定哪些页签当前不适合被改写，
 * 并把需要的对象（如面板实例）一并取出，避免调用方再查一次
 */
export function findCustomTabForReuse<T>(
    customId: string,
    pick: (tab: Tab) => T | null,
): { tab: Tab; target: T } | null {
    for (const tab of getOpenedCustomTabs(customId)) {
        const target = pick(tab);
        if (target !== null) {
            return { tab, target };
        }
    }
    return null;
}
