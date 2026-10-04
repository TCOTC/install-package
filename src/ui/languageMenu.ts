/**
 * 「界面语言」菜单
 *
 * 用途是快速检查集市包的 i18n：切的是整个思源界面（不只是本插件的文字），
 * 因此提交后由思源自行重载界面（内核广播 `setAppearance`，前端检测到 `lang` 变化后重载），
 * 插件不做重载
 *
 * 注意：调用方需先在点击处理里 `stopPropagation`，否则该按钮不在菜单内，
 * 思源的全局点击处理会把它当作「点了菜单外面」立即收起
 */

import { Menu } from "siyuan";
import { currentInterfaceLang, interfaceLangOptions, switchInterfaceLang } from "../settings/interfaceLanguage";
import { NO_MENU_ICON } from "./menuItem";

/** 在锚点按钮下方展开界面语言菜单，并勾选当前语言 */
export function openInterfaceLanguageMenu(anchor: HTMLElement): void {
    const menu = new Menu("install-package-language");
    const current = currentInterfaceLang();
    for (const option of interfaceLangOptions()) {
        menu.addItem({
            ...NO_MENU_ICON,
            label: option.label,
            checked: option.lang === current,
            click: () => {
                void switchInterfaceLang(option.lang);
            },
        });
    }
    const rect = anchor.getBoundingClientRect();
    // 菜单在按钮下方展开；下方空间不足时由思源的定位逻辑上移
    menu.open({ x: rect.left, y: rect.bottom, isLeft: false });
}
