/**
 * 前端种类判定（纯函数，不依赖宿主）
 *
 * 思源有五个前端：桌面、分离窗口、移动端，以及浏览器里的桌面版与移动版。本插件在五个前端上跑
 * 同一套代码，只有「面板挂在哪里」不同：桌面端（含分离窗口、浏览器桌面版）有自定义页签，
 * 移动端（含浏览器移动版）没有页签，面板改用对话框承载。
 *
 * 判定必须走宿主的 `getFrontend()`，不要自己嗅探 UA：分离窗口、设置窗口与主窗口的
 * `navigator.userAgent` 相同，只有宿主知道当前是哪个前端。宿主的调用隔离在 `infra/desktop.ts`，
 * 本模块因此保持无导入，可直接单测
 */

/** 与宿主 `getFrontend()` 的取值一致 */
export type PluginFrontend = "desktop" | "desktop-window" | "mobile" | "browser-desktop" | "browser-mobile";

/**
 * 是否移动端前端
 *
 * 移动端缺少桌面的整套布局元素（`#toolbar`、`#barPlugins`、`#dockLeft`、`#dockRight`），
 * 自定义页签也完全没有实现（宿主的 `openTab` / `addTab` / `getAllTabs` 在移动端都是空实现）
 */
export function isMobileFrontendOf(frontend: string): boolean {
    return frontend === "mobile" || frontend === "browser-mobile";
}
