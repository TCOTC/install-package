/**
 * 没有图标的菜单项
 *
 * 思源的 `MenuItem` 在不传 `iconHTML` 时会渲染一个空的 `<svg class="b3-menu__icon">` 占位，
 * 而 `.b3-menu__icon` 是 `16px` 宽加 `8px` 右边距（`component/_menu.scss`），
 * 于是这些菜单项的文案左边会多出一块 24px 的空白。
 *
 * 传空串（`typeof iconHTML === "string"` 命中）即不再生成该占位元素——思源自身也是这么做的。
 */

/** 展开到 `Menu.addItem` 的选项里，表示该菜单项不显示图标 */
export const NO_MENU_ICON = { iconHTML: "" } as const;
