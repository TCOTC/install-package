import "./index.scss";
import { Custom, getAllTabs, Menu, Plugin } from "siyuan";
import { i18n, setI18n, type PluginI18n } from "./infra/i18n";
import { clearMessagePrefix, message, setMessagePrefix } from "./infra/message";
import { clearRuntimeSecretCache, createSetting, loadSetting } from "./settings/setting";
import { InstallPanel, setPendingInstallPreset } from "./ui/panel";
import type { InstallPanelPreset } from "./ui/panelData";
import { BazaarPrPanel } from "./ui/prPanel";
import { InstalledPanel } from "./ui/installedPanel";
import { LocalPackagesMenu } from "./ui/localPackagesMenu";
import {
    BAZAAR_PR_ICON_ID,
    INSTALL_PACKAGE_ICON_ID,
    INSTALL_PACKAGE_ICON_SYMBOLS,
    LIST_ICON_ID,
    LOCAL_PACKAGE_ICON_ID,
    REFRESH_ICON_ID,
    SETTINGS_ICON_ID,
} from "./ui/icons";
import { findCustomTabForReuse, focusCustomTab, openNewCustomTab, openOrFocusCustomTab } from "./ui/tabs";
import { openMenuFlushSide, topBarMenuAnchor } from "./ui/menuPosition";
import { destroyGitHubNotice, setOpenPluginSettingsHandler } from "./github/githubNotice";
import { abortAllActiveInstalls } from "./install/installSession";
import { initSelfPackage } from "./install/selfPackage";
import { fetchSyncPost } from "./infra/kernelClient";
import { normalizeRepoKey } from "./infra/repoKey";

/** 与 addTab 的 type 一致，openTab 的 custom.id 为 plugin.name + INSTALL_TAB_TYPE */
export const INSTALL_TAB_TYPE = "install_package_panel";
/** 「集市 PR」页的 addTab type，openTab 的 custom.id 为 plugin.name + BAZAAR_PR_TAB_TYPE */
export const BAZAAR_PR_TAB_TYPE = "bazaar_pr_panel";
/** 「本地集市包」页的 addTab type，openTab 的 custom.id 为 plugin.name + LOCAL_TAB_TYPE */
export const LOCAL_TAB_TYPE = "installed_package_panel";

/** 自定义页签 `Custom` 与其面板实例；关闭页签时调用各自的 `destroy` */
const tabPanels = new Map<Custom, InstallPanel | BazaarPrPanel | InstalledPanel>();

/** 自定义页签关闭时由 `addTab.destroy` 调用，销毁面板并解除登记 */
function destroyTabPanel(custom: Custom): void {
    const panel = tabPanels.get(custom);
    if (panel) {
        panel.destroy();
        tabPanels.delete(custom);
    }
}

export default class InstallPackage extends Plugin {
    private installTabCustomId = this.name + INSTALL_TAB_TYPE;
    private bazaarPrTabCustomId = this.name + BAZAAR_PR_TAB_TYPE;
    private localTabCustomId = this.name + LOCAL_TAB_TYPE;
    /** 「本地集市包列表」所在的菜单；在读数据前不开，数据到齐后才建并展示 */
    private listMenu?: Menu;
    /** 列表本体；菜单关闭时销毁 */
    private localPackagesMenu?: LocalPackagesMenu;
    /** 顶栏按钮；命令面板或快捷键触发「本地集市包列表」时用它作为菜单定位锚点 */
    private topBarElement?: HTMLElement;

    onload() {
        setMessagePrefix(this.displayName);
        setI18n(this.i18n as PluginI18n);
        initSelfPackage(this.name);

        // 图标定义集中在 src/ui/icons.ts（含从思源内置图标集复制的几个，避免思源改图标时影响本插件）
        this.addIcons(INSTALL_PACKAGE_ICON_SYMBOLS);

        const openPluginSettings = this.openSetting.bind(this);
        const openInstallTab = this.openInstallTab.bind(this);
        // 面板需要知道插件自身包名，用于把「卸载」目标里的插件自身剔除
        const pluginName = this.name;
        this.addTab({
            type: INSTALL_TAB_TYPE,
            init(this: Custom) {
                tabPanels.set(this, new InstallPanel(this, pluginName));
            },
            destroy(this: Custom) {
                destroyTabPanel(this);
            },
        });
        this.addTab({
            type: BAZAAR_PR_TAB_TYPE,
            init(this: Custom) {
                tabPanels.set(this, new BazaarPrPanel(this, openInstallTab));
            },
            destroy(this: Custom) {
                destroyTabPanel(this);
            },
        });
        this.addTab({
            type: LOCAL_TAB_TYPE,
            init(this: Custom) {
                tabPanels.set(this, new InstalledPanel(this, openInstallTab, pluginName));
            },
            destroy(this: Custom) {
                destroyTabPanel(this);
            },
        });

        this.topBarElement = this.addTopBar({
            icon: INSTALL_PACKAGE_ICON_ID,
            title: i18n.title,
            position: "right",
            callback: () => {
                const anchor = this.topBarElement;
                if (anchor === undefined) {
                    return;
                }
                // 菜单项与 issue #41 的顺序一致
                const menu = new Menu("install-package-entry", () => this.closeLocalPackagesMenu());
                if (menu.isOpen) {
                    // 再次点击顶栏按钮时构造方法已经收起菜单，无需重复添加菜单项
                    return;
                }
                menu.addItem({
                    icon: INSTALL_PACKAGE_ICON_ID,
                    label: i18n.title,
                    click: () => {
                        this.openInstallTab();
                    },
                });
                menu.addItem({
                    icon: BAZAAR_PR_ICON_ID,
                    label: i18n.bazaarPrTitle,
                    click: () => {
                        this.openBazaarPrTab();
                    },
                });
                menu.addSeparator();
                menu.addItem({
                    icon: LOCAL_PACKAGE_ICON_ID,
                    label: i18n.installedTitle,
                    click: () => {
                        this.openLocalTab();
                    },
                });
                menu.addItem({
                    icon: LIST_ICON_ID,
                    label: i18n.localListTitle,
                    click: () => {
                        // 不阻止菜单关闭：数据到齐后会另开一个菜单展示列表
                        this.openLocalPackagesMenu(anchor);
                    },
                });
                menu.addSeparator();
                menu.addItem({
                    icon: REFRESH_ICON_ID,
                    label: i18n.reloadUI,
                    click: () => {
                        void fetchSyncPost("/api/ui/reloadUI");
                    },
                });
                menu.addItem({
                    icon: SETTINGS_ICON_ID,
                    label: i18n.openPluginSettings,
                    click: openPluginSettings,
                });
                // 入口菜单按按钮原位弹出，不做贴边处理（贴边只给「本地集市包列表」用）
                const rect = topBarMenuAnchor(anchor);
                menu.open({
                    x: rect.right,
                    y: rect.bottom,
                    isLeft: true,
                });
            },
        });

        // 入口菜单前 4 项同时注册为思源命令，可在「设置 - 快捷键」或命令面板中调用
        this.registerEntryCommands();

        try {
            this.setting = createSetting(this);
            setOpenPluginSettingsHandler(() => this.openSetting());
        } catch (error) {
            console.error("Failed to create setting:", error);
            return;
        }
        void loadSetting(this);

        console.log(this.displayName, "plugin loaded");
    }

    /**
     * 打开安装页签
     *
     * 顶栏菜单打开的是带输入框的完整表单，每次都是新页签；集市 PR 页带来目标的是没带输入框的精简形态，
     * **按包复用**：同一个包已打开就直接切过去并刷新来源信息，不同包各占一个页签
     */
    private openInstallTab(preset?: InstallPanelPreset): void {
        if (preset === undefined) {
            // 清掉可能遗留的待载入目标，保证新面板是空的完整表单
            setPendingInstallPreset(null);
            this.createInstallTab();
            return;
        }
        const repoKey = normalizeRepoKey(preset.repoKey);
        const reusable = findCustomTabForReuse(this.installTabCustomId, (tab) => {
            const panel = tabPanels.get(tab.model as Custom);
            // 完整表单的键为空串，永远不会等于这里的 repoKey，因此不会被复用
            return panel instanceof InstallPanel && panel.getPresetRepoKey() === repoKey ? panel : null;
        });
        if (reusable !== null) {
            reusable.target.applyPreset(preset);
            focusCustomTab(reusable.tab);
            return;
        }
        // 这个包还没有安装页签：新建一个，目标交给它的构造函数载入
        setPendingInstallPreset(preset);
        this.createInstallTab();
    }

    private createInstallTab(): void {
        openNewCustomTab({
            app: this.app,
            customId: this.installTabCustomId,
            icon: INSTALL_PACKAGE_ICON_ID,
            title: i18n.title,
        });
    }

    private openBazaarPrTab(): void {
        openOrFocusCustomTab({
            app: this.app,
            customId: this.bazaarPrTabCustomId,
            icon: BAZAAR_PR_ICON_ID,
            title: i18n.bazaarPrTitle,
        });
    }

    private openLocalTab(): void {
        openOrFocusCustomTab({
            app: this.app,
            customId: this.localTabCustomId,
            icon: LOCAL_PACKAGE_ICON_ID,
            title: i18n.installedTitle,
        });
    }

    /**
     * 把入口菜单的前 4 个功能项注册为思源命令
     *
     * 命令会出现在「设置 - 快捷键」与命令面板中；`hotkey` 为空串表示默认不占用任何快捷键，由用户自行绑定。
     * langKey 直接复用入口菜单的 i18n 键，命令名称与菜单项保持一致
     */
    private registerEntryCommands(): void {
        this.addCommand({
            langKey: "title",
            hotkey: "",
            callback: () => {
                this.openInstallTab();
            },
        });
        this.addCommand({
            langKey: "bazaarPrTitle",
            hotkey: "",
            callback: () => {
                this.openBazaarPrTab();
            },
        });
        this.addCommand({
            langKey: "installedTitle",
            hotkey: "",
            callback: () => {
                this.openLocalTab();
            },
        });
        this.addCommand({
            langKey: "localListTitle",
            hotkey: "",
            callback: () => {
                // 「本地集市包列表」需要锚点，命令触发时用顶栏按钮，定位与点击入口一致
                const anchor = this.topBarElement;
                if (anchor !== undefined) {
                    this.openLocalPackagesMenu(anchor);
                }
            },
        });
    }

    /**
     * 打开「本地集市包列表」
     *
     * 菜单的宽高都由内容撑开，先把列表数据读出来再展示，否则会看到菜单先出现、随后突然变高。
     * 这里要等入口菜单收完再动手：思源在点击回调返回之后还会清一次菜单内容并调用它的关闭回调，
     * 此时创建的菜单会被那个关闭回调连带收走
     */
    private openLocalPackagesMenu(anchor: HTMLElement): void {
        window.setTimeout(() => {
            void this.startLocalPackagesMenu(anchor);
        }, 0);
    }

    /** 读列表 → 数据到齐后新建菜单并展示；读取失败时提示并不开菜单 */
    private async startLocalPackagesMenu(anchor: HTMLElement): Promise<void> {
        // 新建菜单时思源会先清空共用的菜单容器，顺手收掉上一个列表菜单
        const menu = new Menu("install-package-local-list", () => this.closeLocalPackagesMenu());
        const itemsElement = menu.element.querySelector(":scope > .b3-menu__items");
        if (!(itemsElement instanceof HTMLElement)) {
            return;
        }
        const list = new LocalPackagesMenu(itemsElement, () => menu.close());
        this.listMenu = menu;
        this.localPackagesMenu = list;
        if (!(await list.start())) {
            this.closeLocalPackagesMenu();
            this.listMenu = undefined;
            message(i18n.localListLoadFailed);
            return;
        }
        if (this.localPackagesMenu !== list) {
            // 读数据期间列表已被替换或插件已被禁用
            return;
        }
        // 列表内容宽窄差别大，向锚点所在的那一侧贴边看起来更整齐
        openMenuFlushSide(menu, anchor);
    }

    /** 菜单关闭时调用：在途的列表加载凭销毁标记自行作废 */
    private closeLocalPackagesMenu(): void {
        this.localPackagesMenu?.destroy();
        this.localPackagesMenu = undefined;
    }

    onDataChanged() {
        // 避免数据同步时重启插件导致自定义页签内容样式抖动
        loadSetting(this);
    }

    onunload() {
        abortAllActiveInstalls();
        destroyGitHubNotice();
        clearRuntimeSecretCache();
        clearMessagePrefix();
        // 列表还开着时先收起菜单：列表里的控件指向本插件的回调
        if (this.localPackagesMenu?.isAttached() === true) {
            this.listMenu?.close();
        }
        this.closeLocalPackagesMenu();
        this.listMenu = undefined;
        for (const panel of tabPanels.values()) {
            panel.destroy();
        }
        tabPanels.clear();
        for (const customId of [this.installTabCustomId, this.bazaarPrTabCustomId, this.localTabCustomId]) {
            const tabsToClose = getAllTabs(customId);
            for (const tab of tabsToClose) {
                try {
                    tab.close();
                } catch (e) {
                    console.error(this.displayName, "close tab failed:", e);
                }
            }
        }

        console.log(this.displayName, "plugin unloaded");
    }

    uninstall() {
        // 删除 Token 密文文件夹
        this.removeData("secret");

        console.log(this.displayName, "plugin uninstalled");
    }

}
