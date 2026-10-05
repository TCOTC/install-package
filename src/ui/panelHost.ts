/**
 * 面板宿主：把「面板挂在哪里」与面板本身解耦
 *
 * 桌面端面板挂在自定义页签（`Custom`）里，表单数据随 layout 持久化，页签关闭时由 `addTab.destroy`
 * 收尾；移动端没有自定义页签，面板挂在对话框里，数据只存活在对话框存在期间。
 *
 * 面板只依赖本接口，因此不需要知道自己被谁承载。两个宿主的差异只在三处：标题写到哪儿、
 * 数据落在哪儿、以及关闭由谁触发
 */

import { saveLayout, type Custom } from "siyuan";

export interface PanelHost {
    /** 面板挂载的根节点（内容由面板自己填充） */
    readonly element: HTMLElement;
    /** 宿主持有的面板数据；面板可以整体替换它（如把读出的表单换成规范化后的对象） */
    data: Record<string, unknown>;
    /** 更新标题：页签写页签标题，对话框写对话框标题栏 */
    setTitle(title: string): void;
    /** 把当前 `data` 落盘（字段改动的防抖回调最终落到这里） */
    persist(): void;
}

/**
 * 自定义页签宿主（桌面、分离窗口、浏览器桌面版）
 *
 * 数据就是页签自己的 `Custom.data`，思源序列化 layout 时会带上它；`saveLayout` 的入参回调
 * 是「layout 保存完成」通知，这里不需要，因此传空函数（与页签原有行为一致）
 */
export function customTabPanelHost(custom: Custom): PanelHost {
    return {
        element: custom.element as HTMLElement,
        get data(): Record<string, unknown> {
            return custom.data as Record<string, unknown>;
        },
        set data(value: Record<string, unknown>) {
            custom.data = value;
        },
        setTitle: (title) => {
            custom.tab.updateTitle(title);
        },
        persist: () => saveLayout(() => {}),
    };
}
