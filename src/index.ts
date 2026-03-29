import "./index.scss";
import { Custom, Plugin, openTab } from "siyuan";
import { i18n, setI18n, type PluginI18n } from "./modules/i18n";
import { setMessagePrefix } from "./modules/message";
import { createSetting, loadSetting } from "./modules/setting";
import { InstallPanelController } from "./modules/panel";
import { setOpenPluginSettingsHandler } from "./modules/githubNotice";

/** 顶栏与 openTab 自定义页签共用的图标 id */
export const INSTALL_PACKAGE_ICON_ID = "iconInstallPackage";
/** 与 addTab 的 type 一致，openTab 的 custom.id 为 plugin.name + INSTALL_TAB_TYPE */
export const INSTALL_TAB_TYPE = "install_panel";

export default class InstallPackage extends Plugin {
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
                const controller = new InstallPanelController(this, {
                    openPluginSettings,
                });
                controller.init();
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
                        id: this.name + INSTALL_TAB_TYPE,
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
        // console.log("InstallPackage unloaded");
    }

    uninstall() {
        // 删除 Token 密文文件夹
        this.removeData("secret");

        console.log(this.displayName, "plugin uninstalled");
    }

}
