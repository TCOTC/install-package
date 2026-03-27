import { Custom, saveLayout } from "siyuan";
import { i18n } from "./i18n";
import { RepoParser } from "./repoParser";

declare global {
    interface Window {
        require?(moduleName: "electron"): typeof import("electron");
        require?(moduleName: string): any;
    }
}

const electron: typeof import("electron") | undefined = (() => {
    try {
        return typeof window !== "undefined" ? window.require?.("electron") : undefined;
    } catch {
        return undefined;
    }
})();

/** 与 addTab 的 type 一致，openTab 的 custom.id 为 plugin.name + INSTALL_TAB_TYPE */
export const INSTALL_TAB_TYPE = "install_panel";

/** 顶栏与 openTab 自定义页签共用的图标 id。通过 addIcons 注册 symbol，图标原始来源：https://www.svgrepo.com/svg/355075/install */
export const INSTALL_PACKAGE_ICON_ID = "iconInstallPackage";

export const INSTALL_PACKAGE_ICON_SYMBOL = `<symbol id="${INSTALL_PACKAGE_ICON_ID}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path fill="none" stroke="currentColor" stroke-width="2" d="M19,13.5 L19,17.5 L12,22 L5,17.5 L5,13.5 M12,22 L12,13.5 M18.5,8.5 L12,4.5 L15.5,2 L22,6 L18.5,8.5 L18.5,8.5 L18.5,8.5 Z M5.5,8.5 L12,4.5 L8.5,2 L2,6 L5.5,8.5 L5.5,8.5 L5.5,8.5 Z M18.5,9 L12,13 L15.5,15.5 L22,11.5 L18.5,9 L18.5,9 L18.5,9 Z M5.5,9 L12,13 L8.5,15.5 L2,11.5 L5.5,9 L5.5,9 Z"/>
</symbol>`;

/** 持久化在自定义页签 layout.customModelData 中的表单（与 Custom.data 为同一引用） */
export interface InstallTabPanelData {
    url: string;
    version: string;
    enable: "enable" | "disable";
}

/** 标准化自定义页签数据，确保数据格式正确 */
export function normalizeInstallTabPanelData(custom: Custom): InstallTabPanelData {
    if (!custom.data || typeof custom.data !== "object") {
        custom.data = {
            url: "",
            version: "",
            enable: "enable",
        } as InstallTabPanelData;
        return custom.data as InstallTabPanelData;
    }
    const panelData = custom.data as InstallTabPanelData;
    if (typeof panelData.url !== "string") {
        panelData.url = "";
    }
    if (typeof panelData.version !== "string") {
        panelData.version = "";
    }
    if (panelData.enable !== "enable" && panelData.enable !== "disable") {
        panelData.enable = "enable";
    }
    return panelData;
}

export interface InstallTabPanelCallbacks {
    installPackage: (
        urlInput: HTMLInputElement,
        versionInput: HTMLInputElement,
        enable: boolean,
        repoUrlController: RepoParser
    ) => void | Promise<void>;
    openDirectory: (relPath: string) => void;
    openDevTools: () => void;
    openPluginSettings: () => void;
}

/**
 * 自定义页签内容：安装表单与操作（在 addTab 的 init 中调用）
 */
export function initInstallPanel(custom: Custom, callbacks: InstallTabPanelCallbacks): void {
    const root = custom.element as HTMLElement;
    // TODO 支持记忆历史安装记录，增加一个按钮打开菜单可以填历史安装的仓库 URL 和版本号
    root.innerHTML = `
    <div class="install-package__panel">
        <div class="install-package__main">
            <div class="install-package__url-label install-package__label">${i18n.urlLabel}</div>
            <div class="install-package__url-row">
                <input data-type="url" class="b3-text-field install-package__input-url" value="" placeholder="https://github.com/user/repo" spellcheck="false">
                <button data-type="refresh-repo" type="button" class="b3-button b3-button--outline">${i18n.repoRefreshButton}</button>
            </div>
            <div class="install-package__left-mid">
                <section class="install-package__field">
                    <div class="install-package__label">${i18n.versionLabel}</div>
                    <input data-type="version" class="b3-text-field fn__block" value="" placeholder="${i18n.versionPlaceholder}" spellcheck="false">
                </section>
            </div>
            <div class="install-package__left-bottom">
                <div class="install-package__label">${i18n.packageInfoTitle}</div>
                <div class="install-package__package-info-card">
                    <p class="install-package__package-info-placeholder">${i18n.packageInfoPlaceholder}</p>
                    <div data-type="repo-preview" class="install-package__preview b3-label__text">${i18n.repoPreviewTip}</div>
                </div>
            </div>
        </div>
        <aside class="install-package__right-col">
            <div class="install-package__right-top-spacer" aria-hidden="true"></div>
            <button data-type="install" type="button" class="b3-button install-package__install" disabled>${i18n.installPackageButton}</button>
            <div class="install-package__right-lower">
                <div class="install-package__enable-row">
                    <span class="install-package__enable-label">${i18n.enableAfterInstall}</span>
                    <input data-type="enable" type="checkbox" class="b3-switch fn__flex-center">
                </div>
                <div class="install-package__right-fill" aria-hidden="true"></div>
                <div class="install-package__shortcuts">
                    <button data-type="shortcut-action" data-action="open-devtools" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}">${i18n.openDevTools}</button>
                    <button data-type="open-directory" data-path="data/plugins" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}" title="data/plugins">${i18n.openPluginsDir}</button>
                    <button data-type="open-directory" data-path="data/storage/petal" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}" title="data/storage/petal">${i18n.openPetalDir}</button>
                    <button data-type="open-directory" data-path="conf/appearance/themes" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}" title="conf/appearance/themes">${i18n.openThemesDir}</button>
                    <button data-type="open-directory" data-path="conf/appearance/icons" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}" title="conf/appearance/icons">${i18n.openIconsDir}</button>
                    <button data-type="open-directory" data-path="data/widgets" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}" title="data/widgets">${i18n.openWidgetsDir}</button>
                    <button data-type="open-directory" data-path="data/templates" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}" title="data/templates">${i18n.openTemplatesDir}</button>
                    <button data-type="shortcut-action" data-action="open-plugin-settings" type="button" class="b3-button b3-button--outline">${i18n.openPluginSettings}</button>
                </div>
            </div>
        </aside>
    </div>`;

    const urlInput = root.querySelector("input[data-type='url']") as HTMLInputElement;
    const repoPreviewEl = root.querySelector("div[data-type='repo-preview']") as HTMLDivElement;
    const versionInput = root.querySelector("input[data-type='version']") as HTMLInputElement;
    const enableCheckbox = root.querySelector("input[data-type='enable']") as HTMLInputElement;
    const installButton = root.querySelector("button[data-type='install']") as HTMLButtonElement;

    const panelData = normalizeInstallTabPanelData(custom);
    urlInput.value = panelData.url;
    versionInput.value = panelData.version;
    enableCheckbox.checked = panelData.enable === "enable";

    let persistTimer: number | undefined;
    let repoParseReady = false;
    const persistPanelData = () => {
        if (!repoParseReady) {
            return;
        }
        panelData.url = urlInput.value;
        panelData.version = versionInput.value;
        panelData.enable = enableCheckbox.checked ? "enable" : "disable";

        window.clearTimeout(persistTimer);
        persistTimer = window.setTimeout(() => {
            persistTimer = undefined;
            saveLayout(() => {});
        }, 400);
    };

    const repoUrlController = new RepoParser(
        urlInput,
        versionInput,
        repoPreviewEl,
        (repoLabel) => {
            custom.tab.updateTitle(repoLabel ?? i18n.title);
        },
        (ready) => {
            repoParseReady = ready;
            installButton.disabled = !ready;
            if (ready) {
                persistPanelData();
            }
        },
    );
    // 立即刷新一次，用于界面重载之后初始化页签
    void repoUrlController.refresh();
    urlInput.addEventListener("input", () => {
        repoUrlController.refresh();
    });
    versionInput.addEventListener("input", persistPanelData);
    enableCheckbox.addEventListener("change", persistPanelData);
    root.querySelector("button[data-type='refresh-repo']")?.addEventListener("click", () => {
        repoUrlController.refresh();
    });

    const getEnableValue = () => enableCheckbox.checked;

    const runInstall = () => {
        if (installButton.disabled) {
            return;
        }
        callbacks.installPackage(urlInput, versionInput, getEnableValue(), repoUrlController);
    };

    // 回车安装
    urlInput.addEventListener("keydown", (event) => {
        if (event.isComposing) {
            return;
        }
        if (
            !event.shiftKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            event.key === "Enter" &&
            !event.repeat
        ) {
            runInstall();
            event.preventDefault();
            event.stopPropagation();
        }
    });
    if (!urlInput.value.trim()) {
        urlInput.select();
    }

    installButton.addEventListener("click", runInstall);
    root.querySelector(".install-package__shortcuts")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        const actionButton = target.closest("button[data-type='shortcut-action']") as HTMLButtonElement | null;
        const action = actionButton?.dataset.action;
        if (action === "open-devtools") {
            callbacks.openDevTools();
            return;
        }
        if (action === "open-plugin-settings") {
            callbacks.openPluginSettings();
            return;
        }
        const button = target.closest("button[data-type='open-directory']") as HTMLButtonElement | null;
        const path = button?.dataset.path;
        if (path) {
            callbacks.openDirectory(path);
        }
    });
}

