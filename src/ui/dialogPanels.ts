/**
 * 移动端的面板宿主：用对话框承载三个面板
 *
 * 移动端没有自定义页签——宿主的 `openTab` 是空函数、`addTab` 被 `#if !MOBILE` 剥掉、
 * `getAllTabs` 恒返回空数组——因此移动端点击入口原本毫无反应。这里改用 `Dialog`：
 * 它在移动端可用、默认宽度 92vw，内容超出时 `.b3-dialog__body` 内部滚动。
 *
 * 三种面板各自只保留一个对话框（移动端是单窗口模型，不像桌面端那样一个包开一个页签）：
 * 再次点击入口时复用已有对话框并切换目标，安装目标变化仍走面板自己的 `applyPreset`
 */

import { Dialog } from "siyuan";
import { i18n } from "../infra/i18n";
import { InstallPanel } from "./panel";
import type { PanelHost } from "./panelHost";
import type { InstallPanelPreset } from "./panelData";
import { BazaarPrPanel } from "./prPanel";
import { InstalledPanel } from "./installedPanel";

/** 面板种类：安装面板 / 集市 PR 页 / 本地集市包页 */
type PanelKind = "install" | "bazaarPr" | "local";

type DialogPanel = InstallPanel | BazaarPrPanel | InstalledPanel;

interface DialogEntry {
    dialog: Dialog;
    host: PanelHost;
    panel: DialogPanel;
}

export interface DialogPanelsOptions {
    /** 插件自身包名：安装面板据此把插件自身从卸载目标里剔除 */
    pluginName: string;
    /** 打开安装面板：「集市 PR」页的安装键与「本地集市包」页的卡片都用它 */
    openInstallPanel(preset: InstallPanelPreset): void;
}

/**
 * 建一个承载面板的对话框，返回填进面板根节点的宿主
 *
 * 高度给到 86vh：面板内部的日志卡片各自滚动，比让对话框按内容撑高更好用（撑高会超出屏幕）。
 * 面板自带 24px 内边距，对话框只提供容器，因此不额外加内容层的边距
 */
function createDialogHost(kind: PanelKind, title: string, onClosed: (kind: PanelKind) => void): DialogEntry {
    const dialog = new Dialog({
        title,
        width: "92vw",
        height: "86vh",
        content: "",
        destroyCallback: () => onClosed(kind),
    });
    // 给容器套上自己的类名（样式只调整高度分配）。构造参数里没有 `containerClassName`
    // （pin 的 petal 版本未声明），因此建好后自己加
    dialog.element.querySelector(".b3-dialog__container")?.classList.add("jcip-dialog");
    const body = dialog.element.querySelector(".b3-dialog__body");
    let data: Record<string, unknown> = {};
    const host: PanelHost = {
        element: body instanceof HTMLElement ? body : dialog.element,
        get data(): Record<string, unknown> {
            return data;
        },
        set data(value: Record<string, unknown>) {
            data = value;
        },
        setTitle: (next) => {
            const header = dialog.element.querySelector(".b3-dialog__header");
            if (header instanceof HTMLElement) {
                header.textContent = next;
            }
        },
        // 对话框是临时容器：关闭即结束，没有跨会话恢复表单的需求，字段改动不必落盘
        persist: () => undefined,
    };
    return { dialog, host, panel: undefined as unknown as DialogPanel };
}

export class DialogPanels {
    private readonly entries = new Map<PanelKind, DialogEntry>();
    private readonly options: DialogPanelsOptions;

    constructor(options: DialogPanelsOptions) {
        this.options = options;
    }

    /**
     * 打开安装面板
     *
     * 不带目标（顶栏菜单入口）时退回完整表单形态；带目标时切到该目标并重新解析。
     * 移动端只有一个安装对话框，因此所有来源共用它，而不是像桌面端那样一个包一个页签
     */
    openInstall(preset?: InstallPanelPreset): void {
        const existing = this.entries.get("install");
        if (existing !== undefined) {
            // `null` 表示顶栏入口：恢复完整表单形态，但保留用户已经填好的 URL
            (existing.panel as InstallPanel).applyPreset(preset ?? null);
            this.raise(existing);
            return;
        }
        const entry = this.create("install", i18n.title);
        const panel = new InstallPanel(entry.host, this.options.pluginName);
        entry.panel = panel;
        if (preset !== undefined) {
            panel.applyPreset(preset);
        }
    }

    openBazaarPr(): void {
        const existing = this.entries.get("bazaarPr");
        if (existing !== undefined) {
            this.raise(existing);
            return;
        }
        const entry = this.create("bazaarPr", i18n.bazaarPrTitle);
        entry.panel = new BazaarPrPanel(entry.host, this.options.openInstallPanel);
    }

    openLocal(): void {
        const existing = this.entries.get("local");
        if (existing !== undefined) {
            this.raise(existing);
            return;
        }
        const entry = this.create("local", i18n.installedTitle);
        entry.panel = new InstalledPanel(entry.host, this.options.openInstallPanel, this.options.pluginName);
    }

    /** 插件卸载或插件被禁用时关掉所有对话框（移动端的 `getAllTabs` 收不到它们） */
    destroyAll(): void {
        for (const entry of Array.from(this.entries.values())) {
            entry.dialog.destroy();
        }
        this.entries.clear();
    }

    private create(kind: PanelKind, title: string): DialogEntry {
        const entry = createDialogHost(kind, title, (closed) => this.handleClosed(closed));
        this.entries.set(kind, entry);
        return entry;
    }

    /** 对话框被用户关掉（关闭按钮或点遮罩）时销毁面板；`destroyAll` 触发的销毁也走这里 */
    private handleClosed(kind: PanelKind): void {
        const entry = this.entries.get(kind);
        if (entry === undefined) {
            return;
        }
        this.entries.delete(kind);
        entry.panel?.destroy();
    }

    /**
     * 把已有对话框提到最前
     *
     * 同一时刻可能叠着两个（安装面板由集市 PR 页打开），后建的在上面；此处重新取号，
     * 保证「从集市 PR 页再点安装」或「思源协议送达新目标」时被复用的那个出现在最上层
     */
    private raise(entry: DialogEntry): void {
        const root = entry.dialog.element.querySelector(".b3-dialog");
        if (root instanceof HTMLElement) {
            root.style.zIndex = (++window.siyuan.zIndex).toString();
        }
    }
}
