/**
 * 入口菜单里的「本地集市包列表」
 *
 * 用于快速启停本工作空间已安装的集市包。思源的菜单是全局单例（`#commonMenu`），在菜单项回调里
 * 另开一个菜单会把当前菜单清掉，所以这里不新建菜单，而是就地复用入口菜单：入口项的回调同步返回
 * `true` 让菜单保持展开，再把 `.b3-menu__items` 的内容换成列表。
 *
 * 行尾控件与思源集市页的「已下载」保持一致：插件用开关（`/api/petal/setPetalEnabled`），
 * 主题与图标不用开关，改为「使用」（勾）与「禁用」（叉）两个图标按钮（`/api/setting/setTheme`、`setIcon`），
 * 正在使用的那个显示叉、其余显示勾。工具栏右侧是当前类型的总开关：插件是思源的全局插件开关
 * （`/api/setting/setBazaarPetalDisabled`），主题与图标只在用到非默认包时给出一个「恢复默认」的叉。
 */

import { i18n } from "../infra/i18n";
import { fetchSyncPost } from "../infra/kernelClient";
import { message } from "../infra/message";
import { setPackageEnabled } from "../install/install";
import { openPackageDetailPage } from "../install/packageDetail";
import {
    KERNEL_PACKAGE_TYPES,
    kernelPackageTypeLabel,
    listInstalledPackages,
    sortInstalledPackages,
    type InstalledPackage,
    type KernelPackageType,
} from "../install/installedPackages";
import { CLOSE_ICON_ID, INFO_ICON_ID, SELECT_ICON_ID } from "./icons";
import { emptyPackagesText, iconButton, pickDefaultType, rowKey, setStatusText } from "./installedPackageUi";
import { createConsoleLogger, type Logger } from "../infra/logger";

/** 给菜单的 `.b3-menu__items` 加的类：让工具栏与滚动区在里面分列（样式定义在 `index.scss`） */
const LIST_HOST_CLASS = "jcip-list-host";

/** SVG 的 XLink 命名空间：动态替换 `<use>` 的引用时需要按该命名空间写回 */
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

/**
 * 控件是否不可用
 *
 * 与思源集市页一致：不兼容或需要升级思源才能启用的包，在尚未启用时才把控件置灰，
 * 已经启用的包仍允许关掉
 */
function isToggleDisabled(pkg: InstalledPackage): boolean {
    if (!pkg.incompatible && !pkg.disallowInstall) {
        return false;
    }
    return pkg.type === "plugin" ? !pkg.enabled : !pkg.current;
}

export class LocalPackagesMenu {
    /** 入口菜单的 `.b3-menu__items`，列表就地挂在这里 */
    private readonly itemsEl: HTMLElement;
    /** 关闭入口菜单；打开包详情页后要把菜单收起来 */
    private readonly closeMenu: () => void;
    private readonly log: Logger = createConsoleLogger();
    private root?: HTMLDivElement;
    private tabsEl?: HTMLElement;
    private masterEl?: HTMLElement;
    private rowsEl?: HTMLElement;
    private statusEl?: HTMLParagraphElement;
    /** 已安装的集市包；null 表示还没读到 */
    private packages: InstalledPackage[] | null = null;
    /** 当前查看的包类型 */
    private activeType: KernelPackageType = "plugins";
    /** 主题、图标的外观切换进行中；它们会改写同一份外观配置并重刷列表，期间只接受一次操作 */
    private appearanceBusy = false;
    /** 加载序号：重新加载或菜单关闭后作废在途回调 */
    private loadSeq = 0;
    private destroyed = false;

    constructor(itemsEl: HTMLElement, closeMenu: () => void) {
        this.itemsEl = itemsEl;
        this.closeMenu = closeMenu;
    }

    /** 列表是否还挂在菜单里；菜单关闭后思源会清空菜单内容，元素随之离线 */
    isAttached(): boolean {
        return !this.destroyed && this.root?.isConnected === true;
    }

    /**
     * 读取已安装的集市包并渲染列表
     *
     * 先读数据再建容器：菜单的宽高都由内容撑开，先挂一个空列表会让菜单先矮后高；
     * 调用方等返回 true 之后再展示菜单。返回 false 表示读取失败，此时不建任何 DOM
     */
    async start(): Promise<boolean> {
        const packages = await listInstalledPackages(this.log);
        if (this.destroyed || packages === null) {
            return false;
        }
        this.packages = packages;
        this.renderRoot();
        this.pickDefaultType();
        this.syncTabs();
        this.renderMaster();
        this.renderRows();
        this.setStatus(this.emptyStatusText(), false);
        return true;
    }

    /** 建列表容器并绑定事件；由 `start` 在数据到齐后调用 */
    private renderRoot(): void {
        const root = document.createElement("div");
        root.className = "jcip-list";
        // 工具栏与状态行不参与滚动，只有行列表滚动，避免行滚到工具栏底下
        root.innerHTML = `
        <div class="jcip-list__toolbar fn__flex">
            <div class="jcip-list__tabs" data-type="tabs"></div>
            <span class="fn__flex-1"></span>
            <span class="jcip-list__master" data-type="master"></span>
        </div>
        <div class="jcip-list__rows" data-type="rows"></div>
        <p class="jcip-list__status" data-type="status"></p>`;
        this.itemsEl.classList.add(LIST_HOST_CLASS);
        this.itemsEl.replaceChildren(root);
        this.root = root;
        this.tabsEl = root.querySelector("[data-type='tabs']") as HTMLElement;
        this.masterEl = root.querySelector("[data-type='master']") as HTMLElement;
        this.rowsEl = root.querySelector("[data-type='rows']") as HTMLElement;
        this.statusEl = root.querySelector("[data-type='status']") as HTMLParagraphElement;
        root.addEventListener("click", (event) => {
            void this.onClick(event);
        });
        root.addEventListener("change", (event) => {
            void this.onChange(event);
        });
        this.renderTabs();
    }

    /** 菜单关闭，或插件被禁用、卸载时调用；在途回调凭序号自行作废 */
    destroy(): void {
        this.destroyed = true;
        this.loadSeq++;
        // 菜单容器是全局共用的，用完必须把类摘掉，否则下一个菜单也会变成纵向分列
        this.itemsEl.classList.remove(LIST_HOST_CLASS);
    }

    /**
     * 静默拉一次最新状态
     *
     * 主题、图标的切换已先改过界面，这里只用于拿内核的真实状态兜底：
     * 开关状态没变就不重绘（避免列表闪一下），读取失败也保留当前列表（原因已由 `listInstalledPackages` 写进日志）
     */
    private async reloadSilently(): Promise<void> {
        const seq = ++this.loadSeq;
        const packages = await listInstalledPackages(this.log);
        if (this.destroyed || seq !== this.loadSeq || packages === null || this.sameToggleState(packages)) {
            return;
        }
        this.packages = packages;
        this.pickDefaultType();
        this.syncTabs();
        this.renderMaster();
        this.renderRows();
        this.setStatus(this.emptyStatusText(), false);
    }

    /**
     * 静默确认时用：开关状态与当前是否一致
     *
     * 只比对开关相关的字段；版本、仓库来源不会因为一次启停而变化
     */
    private sameToggleState(packages: InstalledPackage[]): boolean {
        if (this.packages === null || this.packages.length !== packages.length) {
            return false;
        }
        for (const pkg of packages) {
            const local = this.packages.find((item) => rowKey(item) === rowKey(pkg));
            if (local === undefined || local.enabled !== pkg.enabled || local.current !== pkg.current) {
                return false;
            }
        }
        return true;
    }

    /** 当前类型一个包都没有而其它类型有时，自动切到第一个有内容的类型，避免打开就见到空列表 */
    private pickDefaultType(): void {
        this.activeType = pickDefaultType(this.packages ?? [], this.activeType);
    }

    private emptyStatusText(): string {
        return emptyPackagesText(this.packages ?? [], this.activeType);
    }

    private setStatus(text: string, isError: boolean): void {
        setStatusText(this.statusEl, text, isError, "jcip-list__status--error");
    }

    /** 当前类型的包，按思源集市「已下载」列表的排序配置排列 */
    private packagesOf(kernelType: KernelPackageType): InstalledPackage[] {
        return sortInstalledPackages(kernelType, (this.packages ?? []).filter((pkg) => pkg.kernelType === kernelType));
    }

    /** 控件所在行对应的包 */
    private packageOf(el: Element): InstalledPackage | undefined {
        const key = el.closest(".jcip-list__item")?.getAttribute("data-key") ?? "";
        return (this.packages ?? []).find((pkg) => rowKey(pkg) === key);
    }

    /**
     * 当前正在使用的非默认主题或图标；主题可能同时占用明亮与暗黑两个
     *
     * 直接用内核下发的 `current`：思源内置的默认主题、图标不在已安装列表里，因此 `current`
     * 为真就说明在用第三方包，不必再比对前端的外观配置（它可能比内核晚一步更新）
     */
    private nonDefaultAppearanceInUse(): InstalledPackage[] {
        return this.packagesOf(this.activeType).filter((pkg) => pkg.current);
    }

    private async onClick(event: Event): Promise<void> {
        if (!(event.target instanceof Element)) {
            return;
        }
        const tab = event.target.closest("button[data-type='tab']");
        if (tab instanceof HTMLButtonElement) {
            this.switchType(tab.dataset.kernelType as KernelPackageType);
            return;
        }
        const button = event.target.closest("button[data-action]");
        if (!(button instanceof HTMLButtonElement) || button.disabled) {
            return;
        }
        switch (button.dataset.action) {
            case "master-reset":
                if (!this.appearanceBusy) {
                    await this.resetAppearance();
                }
                return;
            case "use":
            case "reset":
                if (!this.appearanceBusy) {
                    await this.toggleAppearance(button, button.dataset.action === "use");
                }
                return;
            case "detail": {
                const pkg = this.packageOf(button);
                if (pkg !== undefined) {
                    this.openDetailPage(pkg);
                }
                return;
            }
            default:
                return;
        }
    }

    /**
     * 打开恩源集市里该包的本地详情页，然后收起菜单（详情页会盖在菜单上面）
     */
    private openDetailPage(pkg: InstalledPackage): void {
        openPackageDetailPage(pkg);
        this.closeMenu();
    }
    /** 只有两个开关需要监听：插件行与插件总开关；各自的处理函数会先禁用自己，不会重复触发 */
    private async onChange(event: Event): Promise<void> {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) {
            return;
        }
        if (input.dataset.action === "toggle-plugin") {
            await this.togglePlugin(input);
        } else if (input.dataset.action === "master-plugins") {
            await this.toggleGlobalPlugins(input);
        }
    }

    private switchType(kernelType: KernelPackageType): void {
        if (kernelType === undefined || kernelType === this.activeType) {
            return;
        }
        this.activeType = kernelType;
        this.syncTabs();
        this.renderMaster();
        this.renderRows();
        // 列表还没读到时不写状态行，否则会把「加载中」换成「没有已安装的包」
        if (this.packages !== null) {
            this.setStatus(this.emptyStatusText(), false);
        }
    }

    /** 插件行的开关：启停由内核推送热加载，失败时把开关拨回去 */
    private async togglePlugin(input: HTMLInputElement): Promise<void> {
        const pkg = this.packageOf(input);
        if (pkg === undefined) {
            return;
        }
        const enable = input.checked;
        input.disabled = true;
        try {
            if (await setPackageEnabled("plugin", pkg.name, enable, this.log)) {
                pkg.enabled = enable;
            } else {
                message(i18n.localListToggleFailed);
            }
            // 成功时把新状态、失败时把原状态就地写回控件（开关本身就是被点的元素，不换元素）
            this.applyRowControl(pkg);
        } finally {
            input.disabled = isToggleDisabled(pkg);
        }
    }

    /** 插件总开关：思源的全局插件开关；关掉会连本插件一起禁用，菜单交给 `onunload` 收起 */
    private async toggleGlobalPlugins(input: HTMLInputElement): Promise<void> {
        const petalDisabled = !input.checked;
        input.disabled = true;
        try {
            const response = await fetchSyncPost("/api/setting/setBazaarPetalDisabled", { petalDisabled });
            if (response.code === 0) {
                return;
            }
            input.checked = !input.checked;
            message(i18n.localListToggleFailed);
        } finally {
            input.disabled = this.packagesOf("plugins").length === 0;
        }
    }

    /** 主题、图标行的「使用」与「禁用」；先改界面，再让内核去切，失败时改回来 */
    private async toggleAppearance(button: HTMLButtonElement, enable: boolean): Promise<void> {
        const pkg = this.packageOf(button);
        if (pkg === undefined) {
            return;
        }
        this.appearanceBusy = true;
        const snapshot = this.captureAppearanceState(pkg.kernelType);
        // 内核切外观要等它返回，先按操作结果改界面，按钮才不会看起来没反应
        this.applyCurrentState(pkg, enable);
        try {
            if (await setPackageEnabled(pkg.type, pkg.name, enable, this.log)) {
                await this.reloadSilently();
                return;
            }
            message(i18n.localListToggleFailed);
            // 还原成操作前的样子；万一内核其实改成功了，紧随其后的静默确认会把真实状态拉回来
            this.restoreAppearanceState(snapshot);
            await this.reloadSilently();
        } finally {
            this.appearanceBusy = false;
        }
    }

    /** 主题、图标的总开关：把正在使用的非默认包切回思源默认 */
    private async resetAppearance(): Promise<void> {
        const targets = this.nonDefaultAppearanceInUse();
        if (targets.length === 0) {
            return;
        }
        this.appearanceBusy = true;
        const snapshot = this.captureAppearanceState(this.activeType);
        for (const pkg of targets) {
            this.applyCurrentState(pkg, false);
        }
        try {
            let allOk = true;
            for (const pkg of targets) {
                if (!(await setPackageEnabled(pkg.type, pkg.name, false, this.log))) {
                    allOk = false;
                }
            }
            if (!allOk) {
                message(i18n.localListToggleFailed);
                this.restoreAppearanceState(snapshot);
            }
            await this.reloadSilently();
        } finally {
            this.appearanceBusy = false;
        }
    }

    /**
     * 立即按操作结果改本地状态，并让被操作的那一行就地翻转
     *
     * 「在用」时同类型的其它包就不再用在用了，因此一并改掉：常见情况下这样改动后本地状态就已与内核一致，
     * 随后的静默确认不会再有差异；只有当内核的实际结果不同（例如主题只声明了单一模式，另一个槽位仍被占用）
     * 才会重画列表纠正。
     *
     * **同步只能改被操作的那一行，且只能改元素状态而不能换元素**：思源在点击事件的冒泡里会检查点击目标是否还在菜单里
     * （`app/src/menus/menuClick.ts` 的 `globalClickHideMenu`），一旦被点的按钮已被摘除，它会当作“点了菜单外面”
     * 顺手收起整个菜单。总开关与其它行属于结构性变化，放到下一个任务里重画
     */
    private applyCurrentState(pkg: InstalledPackage, current: boolean): void {
        pkg.current = current;
        let othersChanged = false;
        if (current) {
            for (const other of this.packagesOf(pkg.kernelType)) {
                if (other !== pkg && other.current) {
                    other.current = false;
                    othersChanged = true;
                }
            }
        }
        this.applyRowControl(pkg);
        window.setTimeout(() => {
            if (this.destroyed) {
                return;
            }
            if (othersChanged) {
                this.renderRows();
            }
            this.renderMaster();
        }, 0);
    }

    /** 记录某一类型各包的「在用」状态，供操作失败时还原 */
    private captureAppearanceState(kernelType: KernelPackageType): Map<string, boolean> {
        const snapshot = new Map<string, boolean>();
        for (const pkg of this.packagesOf(kernelType)) {
            snapshot.set(rowKey(pkg), pkg.current);
        }
        return snapshot;
    }

    /** 还原「在用」状态并就地更新受影响的控件 */
    private restoreAppearanceState(snapshot: Map<string, boolean>): void {
        for (const pkg of this.packages ?? []) {
            const current = snapshot.get(rowKey(pkg));
            if (current !== undefined && current !== pkg.current) {
                pkg.current = current;
                this.applyRowControl(pkg);
            }
        }
        this.renderMaster();
    }

    /** 某一行的元素；列表可能已重画或菜单已收起，取不到时返回 undefined */
    private rowOf(pkg: InstalledPackage): HTMLElement | undefined {
        const key = rowKey(pkg);
        const rows = this.rowsEl?.querySelectorAll<HTMLElement>(".jcip-list__item");
        return rows === undefined ? undefined : Array.from(rows).find((row) => row.dataset.key === key);
    }

    /**
     * 就地更新某一行的行尾控件
     *
     * 只改元素状态、不替换元素：行尾控件很可能就是刚被点击的元素，摘除它会让思源收起菜单（见 `applyCurrentState`）
     */
    private applyRowControl(pkg: InstalledPackage): void {
        const control = this.rowOf(pkg)?.lastElementChild;
        if (control instanceof HTMLInputElement && control.dataset.action === "toggle-plugin") {
            control.checked = pkg.enabled;
            control.disabled = isToggleDisabled(pkg);
            control.setAttribute("aria-label", pkg.enabled ? i18n.localListDisablePlugin : i18n.localListEnablePlugin);
            control.title = control.disabled ? i18n.localListToggleUnavailable : "";
            return;
        }
        if (control instanceof HTMLButtonElement && (control.dataset.action === "use" || control.dataset.action === "reset")) {
            const current = pkg.current;
            control.dataset.action = current ? "reset" : "use";
            control.setAttribute("aria-label", current ? i18n.localListDisable : i18n.localListUse);
            // 只改 <use> 的引用，且改的是初始标记里同一个 xlink:href（XLink 命名空间），不新增属性
            control.querySelector("use")?.setAttributeNS(
                XLINK_NAMESPACE,
                "xlink:href",
                `#${current ? CLOSE_ICON_ID : SELECT_ICON_ID}`,
            );
            control.disabled = isToggleDisabled(pkg);
            control.title = control.disabled ? i18n.localListToggleUnavailable : "";
        }
    }

    private renderTabs(): void {
        if (this.tabsEl === undefined) {
            return;
        }
        const fragment = document.createDocumentFragment();
        for (const kernelType of KERNEL_PACKAGE_TYPES) {
            const tab = document.createElement("button");
            tab.type = "button";
            tab.className = "jcip-list__tab";
            tab.dataset.type = "tab";
            tab.dataset.kernelType = kernelType;
            tab.textContent = kernelPackageTypeLabel(kernelType);
            fragment.append(tab);
        }
        this.tabsEl.replaceChildren(fragment);
    }

    private syncTabs(): void {
        this.tabsEl?.querySelectorAll("button[data-type='tab']").forEach((tab) => {
            tab.classList.toggle(
                "jcip-list__tab--current",
                tab instanceof HTMLElement && tab.dataset.kernelType === this.activeType,
            );
        });
    }

    /** 总开关按类型渲染：插件是开关，主题与图标是「恢复默认」，挂件与模板没有 */
    private renderMaster(): void {
        if (this.masterEl === undefined) {
            return;
        }
        this.masterEl.replaceChildren();
        if (this.packages === null) {
            return;
        }
        if (this.activeType === "plugins") {
            const petalDisabled = window.siyuan.config?.bazaar.petalDisabled === true;
            const input = document.createElement("input");
            input.type = "checkbox";
            input.className = "b3-switch b3-switch--menu ariaLabel";
            input.dataset.action = "master-plugins";
            input.checked = !petalDisabled;
            input.disabled = this.packagesOf("plugins").length === 0;
            input.setAttribute("data-position", "north");
            // 关掉全局开关会把本插件一起禁用，提示里顺带说一句
            input.setAttribute("aria-label", petalDisabled ? i18n.localListEnableAllPlugins : i18n.localListDisableAllPlugins);
            this.masterEl.append(input);
            return;
        }
        if (this.activeType === "themes" || this.activeType === "icons") {
            if (this.nonDefaultAppearanceInUse().length === 0) {
                return;
            }
            const label = this.activeType === "themes" ? i18n.localListResetTheme : i18n.localListResetIcon;
            this.masterEl.append(iconButton(CLOSE_ICON_ID, label, "master-reset"));
        }
    }

    /** 只渲染当前类型的行；列表为空时靠状态行提示 */
    private renderRows(): void {
        if (this.rowsEl === undefined) {
            return;
        }
        const fragment = document.createDocumentFragment();
        for (const pkg of this.packagesOf(this.activeType)) {
            fragment.append(this.renderRow(pkg));
        }
        this.rowsEl.replaceChildren(fragment);
    }

    private renderRow(pkg: InstalledPackage): HTMLElement {
        const row = document.createElement("div");
        row.className = "b3-menu__item jcip-list__item";
        row.dataset.key = rowKey(pkg);

        const label = document.createElement("span");
        label.className = "jcip-list__label";
        const name = document.createElement("span");
        name.className = "jcip-list__name";
        name.textContent = pkg.displayName;
        if (pkg.displayName !== pkg.name) {
            name.title = pkg.displayName;
        }
        const packageName = document.createElement("span");
        packageName.className = "jcip-list__package";
        packageName.textContent = `(${pkg.name})`;
        if (pkg.displayName !== pkg.name) {
            packageName.title = `(${pkg.name})`;
        }
        label.append(name, packageName);

        const space = document.createElement("span");
        space.className = "fn__flex-1";

        const control = this.renderRowControl(pkg);
        row.append(label, space, iconButton(INFO_ICON_ID, i18n.openPackageDetail, "detail"));
        if (control !== null) {
            row.append(control);
        }
        return row;
    }

    /**
     * 行尾的控件
     *
     * 插件用开关，主题与图标用「使用」（勾）与「禁用」（叉）；挂件与模板没有启用状态，不显示控件（返回 null）
     */
    private renderRowControl(pkg: InstalledPackage): HTMLElement | null {
        if (pkg.type === "plugin") {
            const input = document.createElement("input");
            input.type = "checkbox";
            input.className = "b3-switch b3-switch--menu ariaLabel";
            input.dataset.action = "toggle-plugin";
            input.checked = pkg.enabled;
            input.disabled = isToggleDisabled(pkg);
            input.setAttribute("data-position", "north");
            input.setAttribute("aria-label", pkg.enabled ? i18n.localListDisablePlugin : i18n.localListEnablePlugin);
            if (input.disabled) {
                input.title = i18n.localListToggleUnavailable;
            }
            return input;
        }
        if (pkg.type !== "theme" && pkg.type !== "icon") {
            return null;
        }
        const disabled = isToggleDisabled(pkg);
        const button = pkg.current
            ? iconButton(CLOSE_ICON_ID, i18n.localListDisable, "reset")
            : iconButton(SELECT_ICON_ID, i18n.localListUse, "use");
        button.disabled = disabled;
        if (disabled) {
            button.title = i18n.localListToggleUnavailable;
        }
        return button;
    }
}
