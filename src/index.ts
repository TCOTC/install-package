import "./index.scss";
import { Custom, getAllTabs, Menu, Plugin } from "siyuan";
import { i18n, setI18n, type PluginI18n } from "./infra/i18n";
import { clearMessagePrefix, setMessagePrefix } from "./infra/message";
import { clearRuntimeSecretCache, createSetting, loadSetting } from "./settings/setting";
import { InstallPanel, setPendingInstallPreset, type InstallPanelPreset } from "./ui/panel";
import { BazaarPrPanel } from "./ui/prPanel";
import { findCustomTabForReuse, focusCustomTab, openNewCustomTab, openOrFocusCustomTab } from "./ui/tabs";
import { destroyGitHubNotice, setOpenPluginSettingsHandler } from "./github/githubNotice";
import { abortAllActiveInstalls } from "./install/installSession";
import { initSelfPackage } from "./install/selfPackage";

/** 顶栏与 openTab 自定义页签共用的图标 id */
export const INSTALL_PACKAGE_ICON_ID = "iconInstallPackage";
/** 「集市 PR」页的图标 id */
export const BAZAAR_PR_ICON_ID = "iconBazaarPr";
/** 与 addTab 的 type 一致，openTab 的 custom.id 为 plugin.name + INSTALL_TAB_TYPE */
export const INSTALL_TAB_TYPE = "install_package_panel";
/** 「集市 PR」页的 addTab type，openTab 的 custom.id 为 plugin.name + BAZAAR_PR_TAB_TYPE */
export const BAZAAR_PR_TAB_TYPE = "bazaar_pr_panel";

/** 自定义页签 `Custom` 与其面板实例；关闭页签时调用各自的 `destroy` */
const tabPanels = new Map<Custom, InstallPanel | BazaarPrPanel>();

/** 自定义页签关闭时由 `addTab.destroy` 调用，销毁面板并解除登记 */
function destroyTabPanel(custom: Custom): void {
    const panel = tabPanels.get(custom);
    if (panel) {
        panel.destroy();
        tabPanels.delete(custom);
    }
}

/**
 * 入口菜单的定位锚点
 *
 * 顶栏按钮过多时会被收进「更多」，此时按钮自身没有尺寸，改用「更多」或插件按钮定位
 */
function topBarMenuAnchor(button: HTMLElement): DOMRect {
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

export default class InstallPackage extends Plugin {
    private installTabCustomId = this.name + INSTALL_TAB_TYPE;
    private bazaarPrTabCustomId = this.name + BAZAAR_PR_TAB_TYPE;

    onload() {
        setMessagePrefix(this.displayName);
        setI18n(this.i18n as PluginI18n);
        initSelfPackage(this.name);

        // 图标来源：https://lucide.dev/icons/store、https://lucide.dev/icons/git-pull-request（ISC 许可），描边宽度调整为与内置图标一致
        this.addIcons(`
            <symbol id="${INSTALL_PACKAGE_ICON_ID}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7">
                    <path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5m8.774-10.69a1.12 1.12 0 0 0-1.549 0a2.5 2.5 0 0 1-3.451 0a1.12 1.12 0 0 0-1.548 0a2.5 2.5 0 0 1-3.452 0a1.12 1.12 0 0 0-1.549 0a2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/>
                    <path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/>
                </g>
            </symbol>
            <symbol id="${BAZAAR_PR_ICON_ID}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7">
                    <circle cx="18" cy="18" r="3"/>
                    <circle cx="6" cy="6" r="3"/>
                    <path d="M13 6h3a2 2 0 0 1 2 2v7"/>
                    <path d="M6 9v12"/>
                </g>
            </symbol>
        `);

        const openPluginSettings = this.openSetting.bind(this);
        const openInstallTab = this.openInstallTab.bind(this);
        this.addTab({
            type: INSTALL_TAB_TYPE,
            init(this: Custom) {
                tabPanels.set(this, new InstallPanel(this));
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

        const topBarElement = this.addTopBar({
            icon: INSTALL_PACKAGE_ICON_ID,
            title: i18n.title,
            position: "right",
            callback: () => {
                // 菜单项与 issue #41 的顺序一致；「本地集市包」「本地集市包列表」「重载界面」尚未实现，暂不列出
                const menu = new Menu("install-package-entry");
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
                    icon: "iconSettings",
                    label: i18n.openPluginSettings,
                    click: openPluginSettings,
                });
                const rect = topBarMenuAnchor(topBarElement);
                menu.open({
                    x: rect.right,
                    y: rect.bottom,
                    isLeft: true,
                });
            },
        });

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
        const repoKey = preset.repoKey.trim().toLowerCase();
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

    onDataChanged() {
        // 避免数据同步时重启插件导致自定义页签内容样式抖动
        loadSetting(this);
    }

    onunload() {
        abortAllActiveInstalls();
        destroyGitHubNotice();
        clearRuntimeSecretCache();
        clearMessagePrefix();
        for (const panel of tabPanels.values()) {
            panel.destroy();
        }
        tabPanels.clear();
        for (const customId of [this.installTabCustomId, this.bazaarPrTabCustomId]) {
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
