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
import { type PackageChange } from "../install/packageChange";

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
 * 整屏展示（做法对齐思源移动端的间隔重复界面 `card/openCard.ts`）：
 * - 宽高给 `100%` 而不是 `100vw` / `100dvh`。`.b3-dialog` 用 `--mobile-top-safe-area` 与
 *   `env(safe-area-inset-*)` 预留了刘海与手势区，百分比取的是它的内容盒，因此自动落在安全区内；
 *   `100vw` / `100dvh` 会连内边距一起算上，在刘海屏与全面屏上会溢出视口
 * - 遮罩底色改成表面色：弹出动画期间容器会从 80% 放大，深色遮罩会闪一下；
 *   整屏时遮罩本就看不到，同色后安全区的留白与面板连成一片
 * - 保留自带的关闭图标（移动端 `Dialog` 默认渲染它），面板自己没有关闭入口
 */
function createDialogHost(kind: PanelKind, title: string, onClosed: (kind: PanelKind) => void): DialogEntry {
    const dialog = new Dialog({
        title,
        width: "100%",
        height: "100%",
        content: "",
        destroyCallback: () => onClosed(kind),
    });
    const scrim = dialog.element.querySelector(".b3-dialog__scrim");
    if (scrim instanceof HTMLElement) {
        scrim.style.backgroundColor = "var(--b3-theme-surface)";
    }
    // 给容器套上自己的类名（样式只去掉圆角、边框与阴影，并分配 高度）。构造参数里没有 `containerClassName`
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

    /**
     * 内核侧集市包变更：转给还开着的面板
     *
     * 移动端的面板都在对话框里，`tabPanels` 收不到它们，因此与桌面端各自遍历一条（见 `index.ts`）
     */
    applyPackageChange(change: PackageChange): void {
        for (const entry of this.entries.values()) {
            const panel = entry.panel;
            if (panel instanceof InstallPanel || panel instanceof InstalledPanel) {
                panel.applyPackageChange(change);
            }
        }
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
