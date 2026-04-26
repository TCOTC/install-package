import "./index.scss";
import { Custom, getAllTabs, Plugin, openTab, type Tab } from "siyuan";
import { i18n, setI18n, type PluginI18n } from "./infra/i18n";
import { clearMessagePrefix, setMessagePrefix } from "./infra/message";
import { clearRuntimeSecretCache, createSetting, loadSetting } from "./settings/setting";
import { InstallPanel } from "./ui/panel";
import { destroyGitHubNotice, setOpenPluginSettingsHandler } from "./github/githubNotice";
import { abortAllActiveInstalls } from "./install/installSession";

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

        // 图标原始来源：https://www.svgrepo.com/svg/355075/install
        this.addIcons(`
            <symbol id="${INSTALL_PACKAGE_ICON_ID}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path fill="none" stroke="currentColor" stroke-width="2" d="M19,13.5 L19,17.5 L12,22 L5,17.5 L5,13.5 M12,22 L12,13.5 M18.5,8.5 L12,4.5 L15.5,2 L22,6 L18.5,8.5 L18.5,8.5 L18.5,8.5 Z M5.5,8.5 L12,4.5 L8.5,2 L2,6 L5.5,8.5 L5.5,8.5 L5.5,8.5 Z M18.5,9 L12,13 L15.5,15.5 L22,11.5 L18.5,9 L18.5,9 L18.5,9 Z M5.5,9 L12,13 L8.5,15.5 L2,11.5 L5.5,9 L5.5,9 Z"/>
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
