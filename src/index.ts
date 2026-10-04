import "./index.scss";
import { Custom, getAllTabs, Plugin, openTab } from "siyuan";
import { i18n, setI18n, type PluginI18n } from "./infra/i18n";
import { clearMessagePrefix, setMessagePrefix } from "./infra/message";
import { clearRuntimeSecretCache, createSetting, loadSetting } from "./settings/setting";
import { InstallPanel } from "./ui/panel";
import { destroyGitHubNotice, setOpenPluginSettingsHandler } from "./github/githubNotice";
import { abortAllActiveInstalls } from "./install/installSession";
import { initSelfPackage } from "./install/selfPackage";

/** 顶栏与 openTab 自定义页签共用的图标 id */
export const INSTALL_PACKAGE_ICON_ID = "iconInstallPackage";
/** 与 addTab 的 type 一致，openTab 的 custom.id 为 plugin.name + INSTALL_TAB_TYPE */
export const INSTALL_TAB_TYPE = "install_package_panel";

/** 自定义页签 `Custom` 与面板实例 */
const installPanels = new Map<Custom, InstallPanel>();

export default class InstallPackage extends Plugin {
    private installTabCustomId = this.name + INSTALL_TAB_TYPE;

    onload() {
        setMessagePrefix(this.displayName);
        setI18n(this.i18n as PluginI18n);
        initSelfPackage(this.name);

        // 图标来源：https://lucide.dev/icons/store（ISC 许可），描边宽度调整为与内置图标一致
        this.addIcons(`
            <symbol id="${INSTALL_PACKAGE_ICON_ID}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7">
                    <path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5m8.774-10.69a1.12 1.12 0 0 0-1.549 0a2.5 2.5 0 0 1-3.451 0a1.12 1.12 0 0 0-1.548 0a2.5 2.5 0 0 1-3.452 0a1.12 1.12 0 0 0-1.549 0a2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/>
                    <path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/>
                </g>
            </symbol>
        `);

        const openPluginSettings = this.openSetting.bind(this);
        this.addTab({
            type: INSTALL_TAB_TYPE,
            init(this: Custom) {
                installPanels.set(this, new InstallPanel(this, openPluginSettings));
            },
            destroy(this: Custom) {
                const panel = installPanels.get(this);
                if (panel) {
                    panel.destroy();
                    installPanels.delete(this);
                }
            },
        });

        this.addTopBar({
            icon: INSTALL_PACKAGE_ICON_ID,
            title: i18n.title,
            position: "right",
            callback: () => {
                openTab({
                    app: this.app,
                    custom: {
                        id: this.installTabCustomId,
                        icon: INSTALL_PACKAGE_ICON_ID,
                        title: i18n.title,
                        data: {},
                    },
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

    onDataChanged() {
        // 避免数据同步时重启插件导致自定义页签内容样式抖动
        loadSetting(this);
    }

    onunload() {
        abortAllActiveInstalls();
        destroyGitHubNotice();
        clearRuntimeSecretCache();
        clearMessagePrefix();
        for (const panel of installPanels.values()) {
            panel.destroy();
        }
        installPanels.clear();
        const tabsToClose = getAllTabs(this.installTabCustomId);
        for (const tab of tabsToClose) {
            try {
                tab.close();
            } catch (e) {
                console.error(this.displayName, "close tab failed:", e);
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
