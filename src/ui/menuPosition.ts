/**
 * 「本地集市包列表」菜单的弹出位置
 *
 * 顶栏按钮在右侧时，只按按钮定位会让菜单离窗口右侧还差一条右侧栏的距离，看起来不够「靠边」；
 * 因此弹出后把菜单贴到同侧边栏（右侧栏的左边缘 / 左侧栏的右边缘）。
 *
 * 贴哪一边必须**按锚点当前的实际位置**判断：顶栏项可以被拖动到工具栏任意位置
 * （`app/src/layout/topBarDrag.ts`，插件图标带 `data-topbar-entry` 因而可拖），
 * 按插件自己声明的 `position` 或某个配置项来判断会在拖过之后把菜单弹到对面去
 */

import type { Menu } from "siyuan";
import { isMobileFrontend } from "../infra/desktop";

/** 边栏自身的边框宽度，贴边时让出这一点 */
const DOCK_BORDER = 1;

/**
 * 定位锚点
 *
 * 顶栏按钮过多时会被收进「更多」，此时按钮自身没有尺寸，改用「更多」或插件按钮定位
 */
export function topBarMenuAnchor(button: HTMLElement): DOMRect {
    const own = button.getBoundingClientRect();
    if (own.width > 0) {
        return own;
    }
    for (const selector of ["#barMore", "#barPlugins"]) {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        if (rect !== undefined && rect.width > 0) {
            return rect;
        }
    }
    return own;
}

/**
 * 从顶栏按钮弹出菜单，并向窗口同侧贴边
 *
 * 锚点在窗口左半边时贴左侧栏，在右半边时贴右侧栏（藏起来的一侧宽度为 0，即贴窗口边缘）。
 * 内联的 `left` / `right` 会覆盖 `Menu.open` 里算出的 `left`；思源关闭菜单时会清掉菜单上的内联样式，
 * 不会影响其它菜单
 *
 * 移动端没有侧栏（`#dockLeft` / `#dockRight` 都不存在）、菜单也不再是浮层：`Menu.open` 会忽略坐标，
 * 把菜单展开成底部抽屉，因此这里直接开、不传坐标也不写内联定位
 */
export function openMenuFlushSide(menu: Menu, button: HTMLElement): void {
    if (isMobileFrontend()) {
        menu.open({ x: 0, y: 0 });
        return;
    }
    const rect = topBarMenuAnchor(button);
    const anchorCenter = rect.left + rect.width / 2;
    const toLeft = anchorCenter < window.innerWidth / 2;
    menu.open({
        x: toLeft ? rect.left : rect.right,
        y: rect.bottom + 1,
        isLeft: !toLeft,
    });
    const dock = document.getElementById(toLeft ? "dockLeft" : "dockRight");
    const dockWidth = (dock?.getBoundingClientRect().width ?? 0) + DOCK_BORDER + "px";
    if (toLeft) {
        menu.element.style.left = dockWidth;
        menu.element.style.right = "";
    } else {
        menu.element.style.right = dockWidth;
        menu.element.style.left = "";
    }
}
