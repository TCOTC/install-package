import { Custom, Menu, saveLayout } from "siyuan";
import { i18n } from "../infra/i18n";
import { safeExternalUrl, escapeHtml } from "../infra/html";
import type { Logger } from "../infra/logger";
import { RepoParser, type RepoParseEvent, type RepoReleasesEvent } from "./repoParser";
import { abortInstall, subscribeActiveInstallChange, runInstall } from "../install/installSession";
import {
    clearInstallHistory,
    ensureInstallHistoryLoaded,
    installHistoryUrl,
    listInstallHistory,
    removeInstallHistoryEntry,
    type InstallHistoryEntry,
} from "../install/installHistory";
import { getSelfPackageInfo, isSelfRepoKeySync, reportSelfInstallBlock } from "../install/selfPackage";
import { getInstallPath } from "../install/install";
import { openPackageDetailPage } from "../install/packageDetail";
import { normalizeRepoKey, repoKeyFromOwnerRepo } from "../infra/repoKey";
import { message } from "../infra/message";
import { electron, openDirectory, toggleDevTools } from "../infra/desktop";
import { createBazaarPullLabelChip } from "./bazaarPullLabels";
import { CLOSE_ICON_ID, COPY_ICON_ID, HISTORY_ICON_ID, TRASHCAN_ICON_ID } from "./icons";
import { iconButton } from "./installedPackageUi";
import { InstallProgressButton } from "./installProgressButton";
import { createInstallLogger } from "./logger";
import { installLogCopyPayloadAtOpen } from "./installLogCopy";
import { openInterfaceLanguageMenu } from "./languageMenu";
import { NO_MENU_ICON } from "./menuItem";
import { PanelUninstallTargets, petalDirPath } from "./panelUninstall";
import { persistFormToLayout, type PersistedForm } from "./panelPersistence";
import {
    normalizeData,
    parseInstalled,
    parsePull,
    resolveVersionPin,
    serializeInstalled,
    serializePull,
    takePendingInstallPreset,
    type InstallPanelData,
    type InstallPanelInstalledSource,
    type InstallPanelPreset,
    type InstallPanelPull,
} from "./panelData";
import { InstallPanelUiStore, isRepoParseReadyForInstall, type InstallButtonState } from "./uiStore";
import { InstallPanelVersion } from "./version";

function renderInstallPanel(root: HTMLElement): void {
    root.classList.add("jcip-tab");
    // 中断安装按钮的内层结构（标签层与百分比层）由 InstallProgressButton 填充
    const abortInstallButton = "<button data-type=\"abort-install\" type=\"button\" class=\"b3-button jcip-abort fn__none\"></button>";
    // 打开文件夹依赖 Electron，浏览器与移动端不渲染这两个键
    const openFolderButtons = electron
        ? `<button data-type="open-package-dir" type="button" class="b3-button b3-button--outline fn__none">${i18n.openPackageFolder}</button>
                <button data-type="open-petal-dir" type="button" class="b3-button b3-button--outline fn__none">${i18n.openPluginStorageFolder}</button>`
        : "";
    const actionInstallCore = `
                <button data-type="install" type="button" class="b3-button" disabled>${i18n.installPackageButton}</button>
                ${abortInstallButton}
                <label class="jcip-action__enable">
                    <span class="jcip-action__enable-label">${i18n.enableAfterInstall}</span>
                    <input data-type="enableAfterInstall" type="checkbox" class="b3-switch fn__flex-center">
                </label>
                <button data-type="uninstall" type="button" class="b3-button b3-button--outline fn__none">${i18n.uninstallLocalPackageButton}</button>
                <button data-type="open-detail" type="button" class="b3-button b3-button--outline fn__none">${i18n.openPackageDetail}</button>
                ${openFolderButtons}`;
    root.innerHTML = `
    <div class="jcip-panel">
        <div class="jcip-input">
            <section class="jcip__vflow jcip-input__field jcip-input__field--url">
                <div class="jcip__label">${i18n.urlLabel}</div>
                <div class="jcip-input__url">
                    <input data-type="url" class="b3-text-field fn__block" value="" placeholder="https://github.com/user/repo" spellcheck="false">
                    <button data-type="install-history" type="button" class="block__icon block__icon--show ariaLabel" aria-label="${i18n.installHistoryButton}" data-position="north"><svg><use xlink:href="#${HISTORY_ICON_ID}"></use></svg></button>
                </div>
            </section>
            <section class="jcip__vflow jcip-input__source">
                <div class="jcip__label" data-type="source-label"></div>
                <div class="jcip-input__source-body">
                    <a class="jcip-input__source-title" data-type="source-title" target="_blank" rel="noopener noreferrer"></a>
                    <span class="jcip-input__source-chips" data-type="source-chips"></span>
                </div>
            </section>
            <section class="jcip__vflow jcip-input__field">
                <div class="jcip__label">${i18n.versionLabel}</div>
                <button type="button" data-type="version" class="jcip-version-select fn__block b3-select" disabled></button>
            </section>
            <section class="jcip__vflow jcip-input__button">
                <div class="jcip__label jcip__label--placeholder" aria-hidden="true">&nbsp;</div>
                <button data-type="refresh-repo" type="button" class="b3-button b3-button--outline">${i18n.repoRefreshButton}</button>
            </section>
            <div class="jcip-action__install jcip-action__install--input">${actionInstallCore}
            </div>
        </div>

        <div class="jcip-show">
            <section class="jcip__vflow jcip-show__info">
                <div class="jcip__label">${i18n.packageInfoTitle}</div>
                <div class="jcip__vflow jcip-show__card jcip-show__card--package-info" data-type="repo-info">
                    <p class="jcip-show__text--placeholder" data-type="repo-info-placeholder">${i18n.repoInfoTip}</p>
                    <div class="jcip-repo-summary fn__none" data-type="repo-info-main"></div>
                </div>
            </section>

            <section class="jcip__vflow jcip-show__log">
                <div class="jcip__label">${i18n.installProcessTitle}</div>
                <div class="jcip__vflow jcip-show__card jcip-show__card--log" data-type="install-log">
                    <p class="jcip-show__text--placeholder">${i18n.installProcessPlaceholder}</p>
                </div>
            </section>
        </div>

        <div class="jcip-action">
            <div class="jcip-action__install jcip-action__install--action">${actionInstallCore}
            </div>
            <div class="jcip-action__tools">
                <button data-type="toggle-devtools" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}">${i18n.openDevTools}</button>
                <button data-type="open-directory" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}" title="data/plugins">${i18n.openPluginsDir}</button>
                <button data-type="open-directory" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}" title="data/storage/petal">${i18n.openPetalDir}</button>
                <button data-type="open-directory" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}" title="data/themes">${i18n.openThemesDir}</button>
                <button data-type="open-directory" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}" title="data/icons">${i18n.openIconsDir}</button>
                <button data-type="open-directory" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}" title="data/widgets">${i18n.openWidgetsDir}</button>
                <button data-type="open-directory" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}" title="data/templates">${i18n.openTemplatesDir}</button>
                <button data-type="switch-language" type="button" class="b3-button b3-button--outline">${i18n.switchLanguage}</button>
            </div>
        </div>
    </div>`;
}

/** 来源块的补充说明（纯文本，不可点击） */
function createSourceNote(text: string): HTMLSpanElement {
    const el = document.createElement("span");
    el.className = "jcip-input__source-note";
    el.textContent = text;
    return el;
}

interface InstallPanelElements {
    inputEl: HTMLDivElement;
    urlEl: HTMLInputElement;
    historyButtonEl: HTMLButtonElement;
    versionEl: HTMLButtonElement;
    sourceLabelEl: HTMLDivElement;
    sourceTitleEl: HTMLAnchorElement;
    sourceChipsEl: HTMLElement;
    repoInfoPlaceholderEl: HTMLParagraphElement;
    repoInfoMainEl: HTMLDivElement;
    enableAfterInstallSwitchEls: NodeListOf<HTMLInputElement>;
    installEls: NodeListOf<HTMLButtonElement>;
    abortEls: NodeListOf<HTMLButtonElement>;
    uninstallEls: NodeListOf<HTMLButtonElement>;
    openDetailEls: NodeListOf<HTMLButtonElement>;
    /** 非 Electron 环境中为空列表（按钮不渲染） */
    openPackageDirEls: NodeListOf<HTMLButtonElement>;
    /** 非 Electron 环境中为空列表（按钮不渲染） */
    openPetalDirEls: NodeListOf<HTMLButtonElement>;
    installLogEl: HTMLDivElement;
}

export class InstallPanel {
    private readonly custom: Custom;
    private readonly data: InstallPanelData;
    private readonly root: HTMLElement;
    private readonly elements: InstallPanelElements;
    private readonly log: Logger;
    private readonly clearInstallLog: () => void;
    private readonly repoParser: RepoParser;
    private readonly versionUI: InstallPanelVersion;
    /** 中断安装按钮兼任下载进度条；两处复用同一份按钮，故整体操作 */
    private readonly abortProgress: InstallProgressButton;
    /** 表单的防抖持久化；页签关闭时取消尚未落盘的一次写入 */
    private readonly persistForm: PersistedForm<InstallPanelData>;
    /** 仅通过 `dispatch` 修改的解析/安装面板 UI 状态管理器 */
    private readonly uiStore: InstallPanelUiStore;
    /** 页签关闭时取消订阅 */
    private unsubActiveInstall: (() => void) | undefined;
    /** 与当前仓库匹配的本地集市包（卸载与打开目录几个键的依据） */
    private readonly uninstallTargets: PanelUninstallTargets;
    /**
     * 刚从历史记录选定的仓库键（小写 owner/repo）
     *
     * 填回表单会切换仓库，而解析落定时会按「换了仓库」清空版本；
     * 因此先把目标记在这里，落定到同一仓库时保留刚填的版本（命中即消费）
     */
    private historyPickRepoKey: string | null = null;
    /** 历史记录菜单；页签关闭时收起 */
    private historyMenu: Menu | null = null;
    /** 页签已关闭：异步回调不再改 DOM */
    private destroyed = false;

    constructor(custom: Custom, pluginName: string) {
        this.custom = custom;
        // 入口带入的安装目标随页签数据一道送达；先取出再归一表单，避免它被写回页签数据
        const pendingPreset = takePendingInstallPreset(custom.data as Record<string, unknown>);
        this.persistForm = persistFormToLayout(normalizeData(this.custom.data), () => saveLayout(() => {}));
        this.data = this.persistForm.data;
        this.custom.data = this.data;
        if (pendingPreset !== null) {
            this.storePreset(pendingPreset);
        }
        this.uiStore = new InstallPanelUiStore(this.data.repoKey);
        this.root = this.custom.element as HTMLElement;
        renderInstallPanel(this.root);
        this.elements = {
            inputEl: this.root.querySelector(".jcip-input") as HTMLDivElement,
            urlEl: this.root.querySelector("input[data-type='url']") as HTMLInputElement,
            historyButtonEl: this.root.querySelector("button[data-type='install-history']") as HTMLButtonElement,
            versionEl: this.root.querySelector("[data-type='version']") as HTMLButtonElement,
            sourceLabelEl: this.root.querySelector("[data-type='source-label']") as HTMLDivElement,
            sourceTitleEl: this.root.querySelector("a[data-type='source-title']") as HTMLAnchorElement,
            sourceChipsEl: this.root.querySelector("[data-type='source-chips']") as HTMLElement,
            repoInfoPlaceholderEl: this.root.querySelector("p[data-type='repo-info-placeholder']") as HTMLParagraphElement,
            repoInfoMainEl: this.root.querySelector("div[data-type='repo-info-main']") as HTMLDivElement,
            enableAfterInstallSwitchEls: this.root.querySelectorAll("input[data-type='enableAfterInstall']") as NodeListOf<HTMLInputElement>,
            installEls: this.root.querySelectorAll("button[data-type='install']") as NodeListOf<HTMLButtonElement>,
            abortEls: this.root.querySelectorAll("button[data-type='abort-install']") as NodeListOf<HTMLButtonElement>,
            uninstallEls: this.root.querySelectorAll("button[data-type='uninstall']") as NodeListOf<HTMLButtonElement>,
            openDetailEls: this.root.querySelectorAll("button[data-type='open-detail']") as NodeListOf<HTMLButtonElement>,
            openPackageDirEls: this.root.querySelectorAll("button[data-type='open-package-dir']") as NodeListOf<HTMLButtonElement>,
            openPetalDirEls: this.root.querySelectorAll("button[data-type='open-petal-dir']") as NodeListOf<HTMLButtonElement>,
            installLogEl: this.root.querySelector("div[data-type='install-log']") as HTMLDivElement,
        };
        const logger = createInstallLogger(this.elements.installLogEl);
        this.log = logger.log;
        this.abortProgress = new InstallProgressButton(Array.from(this.elements.abortEls), {
            idle: i18n.abortInstallButton,
            abort: i18n.abortInstallButton,
            installing: i18n.installingPackage,
        });
        // 提前载入自身包信息（自身仓库键与开发环境标记），供安装键的同步判定使用
        void getSelfPackageInfo(this.log);
        this.clearInstallLog = logger.clear;
        this.versionUI = new InstallPanelVersion(
            this.data,
            this.elements.versionEl,
            this.elements.repoInfoMainEl,
            this.log,
            {
                onPickedVersion: this.syncInstallButtonDisabled.bind(this),
            },
        );
        this.repoParser = new RepoParser(this.data, this.log, this.elements.repoInfoMainEl, this.elements.repoInfoPlaceholderEl, {
            onRepoParseEvent: this.applyRepoParseEvent.bind(this),
            onRepoReleasesEvent: this.applyRepoReleasesEvent.bind(this),
        });
        this.uninstallTargets = new PanelUninstallTargets(pluginName, this.log, () => this.syncUninstallButton());
        this.unsubActiveInstall = subscribeActiveInstallChange(() => this.syncInstallButtonDisabled());

        this.init();
        this.applyStoredPreset();
    }

    /**
     * 载入入口带入的安装目标：URL 换成该目标、面板切为对应形态，并重新解析
     */
    applyPreset(preset: InstallPanelPreset): void {
        this.storePreset(preset);
        this.elements.urlEl.value = preset.url;
        this.versionUI.syncDisplayFromData();
        this.applyStoredPreset();
        this.syncEnableAfterInstall();
        void this.repoParser.refresh();
    }

    /**
     * 本面板所属包仓库键（小写 `owner/repo`）；空串表示这是顶栏入口打开的完整表单
     *
     * 集市 PR 页与本地集市包页据此按包复用安装页签：只有同一个包才复用同一个页签
     */
    getPresetRepoKey(): string {
        return this.data.presetRepoKey;
    }

    /**
     * 把入口带入的目标写进页签数据（不碰界面）；形态与来源信息随后由 `applyStoredPreset` 推导
     *
     * 本地集市包来源回填已安装版本（Release 列表到达后由版本控件对齐到实际 tag），
     * 其它来源留空，以便解析完成后落到最新 Release
     */
    private storePreset(preset: InstallPanelPreset): void {
        this.data.url = preset.url;
        this.data.version = preset.installed?.version ?? "";
        this.data.presetRepoKey = normalizeRepoKey(preset.repoKey);
        this.data.presetPull = serializePull(preset.pull);
        this.data.presetInstalled = serializeInstalled(preset.installed);
        // 本地集市包来源：按该包当前的启用状态决定「安装后启用」的初始值，避免装完把原本启用的包停掉
        if (preset.installed?.enableAfterInstall !== undefined) {
            this.data.enableAfterInstall = preset.installed.enableAfterInstall;
        }
    }

    /**
     * 依据页签数据决定形态与来源信息展示
     *
     * 三种形态都由持久化数据推导：页签重载恢复后形态不会退化，也仍能被按包复用
     * - 顶栏入口：完整表单（URL 与版本栏都在）
     * - 集市 PR 页：隐藏 URL 与版本栏，改为展示来源 PR
     * - 本地集市包页：只隐藏 URL 栏，保留版本下拉框，并展示来源本地集市包
     */
    private applyStoredPreset(): void {
        const form = this.currentForm();
        this.elements.inputEl.classList.toggle("jcip-input--compact", form === "pull");
        this.elements.inputEl.classList.toggle("jcip-input--no-url", form === "installed");
        const pull = form === "pull" ? parsePull(this.data.presetPull) : undefined;
        const installed = form === "installed" ? parseInstalled(this.data.presetInstalled) : undefined;
        this.elements.inputEl.classList.toggle("jcip-input--with-source", pull !== undefined || installed !== undefined);
        this.renderSourceInfo(pull, installed);
        this.versionUI.setInstalledVersionAlias(installed?.version ?? "");
    }

    /** 由持久化数据推导面板形态；`presetRepoKey` 为空串说明目标来自顶栏入口 */
    private currentForm(): "full" | "pull" | "installed" {
        if (this.data.presetRepoKey === "") {
            return "full";
        }
        if (this.data.presetInstalled !== "") {
            return "installed";
        }
        return this.data.presetPull !== "" ? "pull" : "full";
    }

    /**
     * 打开安装历史菜单；选中一项即把该仓库 URL 与版本填回表单
     *
     * 菜单在数据就绪之后才建，因此这里先读记录（空菜单本就无法弹出）；
     * 菜单是在点击事件处理之外建的，调用方仍需 `stopPropagation`，避免思源的全局点击收起逻辑收掉当时正打开着的别的菜单
     */
    private async openInstallHistoryMenu(anchor: HTMLElement): Promise<void> {
        await ensureInstallHistoryLoaded();
        if (this.destroyed) {
            return;
        }
        const menu = new Menu("install-package-history", () => {
            this.historyMenu = null;
        });
        this.historyMenu = menu;
        const entries = listInstallHistory();
        if (entries.length === 0) {
            menu.addItem({ type: "readonly", ...NO_MENU_ICON, label: i18n.installHistoryEmpty });
        } else {
            menu.addItem({
                icon: TRASHCAN_ICON_ID,
                label: i18n.installHistoryClear,
                click: () => {
                    void (async (): Promise<void> => {
                        await clearInstallHistory();
                        this.reopenHistoryMenu(anchor, menu);
                    })();
                    // 保持菜单展开：数据清理完后由 reopenHistoryMenu 按最新记录重建
                    return true;
                },
            });
            menu.addSeparator();
            for (const entry of entries) {
                menu.addItem({
                    ...NO_MENU_ICON,
                    // 仓库名与 tag 来自外部数据，转义后再拼进菜单项的 innerHTML
                    label: escapeHtml(`${entry.owner}/${entry.repo} ${entry.version}`),
                    click: () => {
                        this.applyInstallHistoryEntry(entry);
                    },
                    bind: (item) => {
                        item.append(this.createHistoryRemoveButton(entry, anchor, menu));
                    },
                });
            }
        }
        const rect = anchor.getBoundingClientRect();
        menu.open({ x: rect.left, y: rect.bottom, isLeft: false });
    }

    /** 历史行的「删除」按钮：只删这一条，不触发该行的回填 */
    private createHistoryRemoveButton(entry: InstallHistoryEntry, anchor: HTMLElement, menu: Menu): HTMLButtonElement {
        const button = iconButton(CLOSE_ICON_ID, i18n.installHistoryRemove, "remove-history");
        button.classList.add("jcip-history-remove");
        button.addEventListener("click", (event) => {
            // 按钮在菜单项内部，不阻止冒泡会连带触发「选中该历史」的回填
            event.stopPropagation();
            void (async (): Promise<void> => {
                await removeInstallHistoryEntry(entry.owner, entry.repo, entry.version);
                this.reopenHistoryMenu(anchor, menu);
            })();
        });
        return button;
    }

    /**
     * 按最新记录重建菜单
     *
     * 推迟到下一个任务执行：在点击处理里同步摘掉被点的元素后，思源的全局点击处理会因为
     * `target` 已脱离文档而把菜单当成「点在菜单外」收掉。
     * 等待期间菜单若已被收起（用户点了别处）就不再重开，`removeCB` 会把 `historyMenu` 置空
     */
    private reopenHistoryMenu(anchor: HTMLElement, current: Menu): void {
        window.setTimeout(() => {
            if (this.destroyed || this.historyMenu !== current) {
                return;
            }
            current.close();
            this.historyMenu = null;
            void this.openInstallHistoryMenu(anchor);
        }, 0);
    }

    /** 把历史记录中的仓库与版本填回表单，并重新解析该仓库 */
    private applyInstallHistoryEntry(entry: InstallHistoryEntry): void {
        const url = installHistoryUrl(entry);
        // 解析落定到该仓库时要保留刚填的版本，见 resolveVersionPin
        this.historyPickRepoKey = repoKeyFromOwnerRepo(entry.owner, entry.repo);
        this.elements.urlEl.value = url;
        this.data.url = url;
        this.data.version = entry.version;
        this.versionUI.syncDisplayFromData();
        void this.repoParser.refresh();
    }

    /**
     * 在隐藏 URL 栏的形态里展示来源
     *
     * 集市 PR 显示编号与标题（可点击打开该 PR），本地集市包显示包名（可点击打开仓库）与已安装版本；
     * 两种信息不会同时出现，取不到信息时整块不显示
     */
    private renderSourceInfo(pull: InstallPanelPull | undefined, installed: InstallPanelInstalledSource | undefined): void {
        const titleEl = this.elements.sourceTitleEl;
        this.elements.sourceLabelEl.textContent = "";
        titleEl.textContent = "";
        titleEl.removeAttribute("href");
        titleEl.removeAttribute("title");
        this.elements.sourceChipsEl.replaceChildren();
        if (pull !== undefined) {
            this.elements.sourceLabelEl.textContent = i18n.bazaarPrTitle;
            // 文案来自外部数据，一律用 textContent 写入；过长时由样式省略，完整文案放在 title 里
            const label = `#${pull.number} ${pull.title}`.trim();
            titleEl.textContent = label;
            titleEl.title = label;
            const pullUrl = safeExternalUrl(pull.htmlUrl);
            if (pullUrl !== "") {
                titleEl.href = pullUrl;
            }
            this.elements.sourceChipsEl.replaceChildren(
                ...pull.labels.map((item) => createBazaarPullLabelChip(item)),
            );
            return;
        }
        if (installed !== undefined) {
            this.elements.sourceLabelEl.textContent = i18n.installedTitle;
            titleEl.textContent = installed.displayName;
            titleEl.title = installed.displayName;
            // URL 栏里可能是不合法的地址（含非 http/https 协议），不能直接写进 href
            const sourceUrl = safeExternalUrl(this.data.url);
            if (sourceUrl !== "") {
                titleEl.href = sourceUrl;
            }
            this.elements.sourceChipsEl.replaceChildren(
                createSourceNote(i18n.panelSourceInstalledVersion.replace("{version}", installed.version)),
            );
        }
    }

    private init(): void {
        this.elements.urlEl.value = this.data.url;
        this.versionUI.syncVersionDisplay();
        this.syncEnableAfterInstall();

        // 从 URL 输入框单向同步到 `this.data`（trim）；版本由下拉框写入 `this.data`
        // 立即刷新一次，用于界面重载之后初始化页签
        void this.repoParser.refresh();
        this.elements.urlEl.addEventListener("input", () => {
            // 用户手动改动 URL 之后，历史记录选定的版本不再适用
            this.historyPickRepoKey = null;
            this.data.url = this.elements.urlEl.value.trim();
            void this.repoParser.refresh(400);
        });
        this.elements.historyButtonEl.addEventListener("click", (event) => {
            // 新建的菜单不在被点的按钮里，必须阻止冒泡：否则思源在 window 上监听的点击收起逻辑（globalClickHideMenu）会收掉它
            event.stopPropagation();
            void this.openInstallHistoryMenu(this.elements.historyButtonEl);
        });
        for (const cb of this.elements.enableAfterInstallSwitchEls) {
            cb.addEventListener("change", () => {
                this.data.enableAfterInstall = cb.checked;
                for (const o of this.elements.enableAfterInstallSwitchEls) {
                    o.checked = cb.checked;
                }
            });
        }
        this.root.querySelector("button[data-type='refresh-repo']")?.addEventListener("click", () => {
            void this.repoParser.refresh();
        });

        // 回车安装
        this.elements.urlEl.addEventListener("keydown", (event) => {
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
                void this.startInstall();
                event.preventDefault();
                event.stopPropagation();
            }
        });
        this.elements.urlEl.select();

        for (const btn of this.elements.installEls) {
            btn.addEventListener("click", () => void this.startInstall());
        }
        for (const btn of this.elements.abortEls) {
            btn.addEventListener("click", () => {
                this.abortCurrentRepoInstall();
            });
        }
        for (const btn of this.elements.uninstallEls) {
            btn.addEventListener("click", () => {
                void this.uninstallTargets.uninstall();
            });
        }
        for (const btn of this.elements.openDetailEls) {
            btn.addEventListener("click", () => {
                const target = this.uninstallTargets.first;
                if (target !== undefined) {
                    openPackageDetailPage(target);
                }
            });
        }
        // 打开文件夹针对匹配到的第一个包；同一仓库匹配到多个包时由用户按需再次打开
        for (const btn of this.elements.openPackageDirEls) {
            btn.addEventListener("click", () => {
                const target = this.uninstallTargets.first;
                if (target !== undefined) {
                    void openDirectory(`${getInstallPath(target.type)}/${target.name}`);
                }
            });
        }
        for (const btn of this.elements.openPetalDirEls) {
            btn.addEventListener("click", () => {
                const target = this.uninstallTargets.first;
                if (target?.type === "plugin") {
                    void openDirectory(petalDirPath(target.name));
                }
            });
        }

        this.elements.installLogEl.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
            // 在弹出菜单瞬间确定待复制内容；点击菜单项时选区常被清空，故在此刻用 cloneContents 解析选区
            const copyPayload = installLogCopyPayloadAtOpen(this.elements.installLogEl);
            const menu = new Menu("install-package-install-log");
            menu.addItem({
                icon: COPY_ICON_ID,
                label: i18n.copyInstallLog,
                click: () => {
                    void this.copyInstallLogPlainText(copyPayload);
                },
            });
            menu.addItem({
                icon: TRASHCAN_ICON_ID,
                label: i18n.clearInstallLog,
                click: () => {
                    this.clearInstallLog();
                },
            });
            menu.open({
                x: event.clientX,
                y: event.clientY,
                isLeft: false,
            });
        });

        this.root.querySelector(".jcip-action__tools")?.addEventListener("click", async (event: Event): Promise<void> => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }
            const button = target.closest("button[data-type]") as HTMLButtonElement | null;
            switch (button?.dataset.type) {
                case "toggle-devtools":
                    toggleDevTools();
                    break;
                case "open-directory":
                    await openDirectory(button.title);
                    break;
                case "switch-language":
                    // 菜单是在本次点击的处理里新建的，必须阻止事件继续冒泡：
                    // 思源在 window 上监听 click 并调 globalClickHideMenu（app/src/menus/menuClick.ts），
                    // 点中的按钮不在菜单里，新建的菜单会被当成「点了菜单外面」立刻 remove
                    event.stopPropagation();
                    openInterfaceLanguageMenu(button);
                    break;
                default:
                    break;
            }
        });
    }

    /** 把「安装后启用」的当前值同步到两个开关上（入口带入的值与页签重载恢复的值都走这里） */
    private syncEnableAfterInstall(): void {
        for (const cb of this.elements.enableAfterInstallSwitchEls) {
            cb.checked = this.data.enableAfterInstall;
        }
    }

    /**
     * 安装区三态投影。
     *
     * 安装期间隐藏安装按钮（同 issue #18），由「中断安装」按钮兼任进度指示；
     * 该按钮的可点性由两个进度渲染方法各自决定：下载阶段可中断，本地安装阶段不可中断
     */
    private applyInstallButtonState(phase: InstallButtonState): void {
        const installDisabled = phase !== "canInstall";
        const installing = phase === "installing";
        for (const b of this.elements.installEls) {
            b.disabled = installDisabled;
            b.classList.toggle("fn__none", installing);
        }
        for (const b of this.elements.abortEls) {
            b.classList.toggle("fn__none", !installing);
        }
        if (!installing) {
            this.abortProgress.reset();
        }
    }

    /** 安装区三态由 `uiStore.syncInstallButtonState` / `resolveInstallButtonState` 统一推导 */
    private syncInstallButtonDisabled(): void {
        this.uiStore.syncInstallButtonState({
            getSelectedVersion: () => this.data.version,
            resolveOwnerRepo: () => this.repoParser.getOwnerRepo(),
            apply: (state) => {
                const blockReason = this.selfInstallBlockReason();
                this.applyInstallButtonState(blockReason === "" ? state : "cannotInstall");
                this.syncInstallButtonTitle(blockReason);
            },
        });
    }

    /**
     * 目标为插件自身时的安装限制文案；不存在限制时返回空串。
     *
     * 仅依据已载入的自身包信息判断，载入前未及拦住的点击由安装流程内的异步校验兜住；
     * 版本为空不算限制：此时安装键本就因缺少版本而禁用，无需把原因说成版本过低。
     * 判定出限制时把原因写进日志，与安装流程共用去重，不点安装也能看到为何装不了
     */
    private selfInstallBlockReason(): string {
        if (!isSelfRepoKeySync(this.data.repoKey)) {
            return "";
        }
        return reportSelfInstallBlock(this.log, this.data.version);
    }

    /** 把自我安装的限制原因写到安装键的 title 上；禁用状态下的原生提示仍可显示 */
    private syncInstallButtonTitle(text: string): void {
        for (const b of this.elements.installEls) {
            if (text === "") {
                b.removeAttribute("title");
            } else {
                b.title = text;
            }
        }
    }

    /** 中止本面板发起的安装 */
    private abortCurrentRepoInstall(): void {
        const ownerRepo = this.uiStore.getState().activeOwnerRepo;
        if (ownerRepo === null) {
            return;
        }
        abortInstall(ownerRepo.owner, ownerRepo.repo);
    }

    /**
     * 有匹配到的本地集市包时显示针对该包的操作键
     *
     * 同一仓库可能匹配到多个包（实测存在），「打开文件夹」只针对第一个；
     * 存储目录只有插件才有，而且由插件自己在运行时创建，需内核确认存在后才显示入口
     */
    private syncUninstallButton(): void {
        const target = this.uninstallTargets.first;
        const visible = target !== undefined;
        for (const btn of this.elements.uninstallEls) {
            btn.classList.toggle("fn__none", !visible);
        }
        for (const btn of this.elements.openDetailEls) {
            btn.classList.toggle("fn__none", !visible);
            if (target !== undefined) {
                btn.title = target.displayName;
            }
        }
        for (const btn of this.elements.openPackageDirEls) {
            btn.classList.toggle("fn__none", !visible);
            if (target !== undefined) {
                btn.title = `${getInstallPath(target.type)}/${target.name}`;
            }
        }
        const storageVisible = this.uninstallTargets.hasPetalDir();
        for (const btn of this.elements.openPetalDirEls) {
            btn.classList.toggle("fn__none", !storageVisible);
            if (target !== undefined && target.type === "plugin") {
                btn.title = petalDirPath(target.name);
            }
        }
    }

    /** Release：拉取开始，或列表 / `latestTag` 更新 */
    private applyRepoReleasesEvent(event: RepoReleasesEvent): void {
        if (event.type === "fetchStart") {
            this.versionUI.onReleasesFetchStart();
            return;
        }
        this.versionUI.onReleasesChanged(event.data);
        this.syncInstallButtonDisabled();
    }

    /**
     * 解析事件落地：`dispatch` 更新切片、版本控件与安装按钮投影；
     * 页签标题仅在 settled 后更新，不需要在 `parsing` 阶段把标题刷成默认文案。
     */
    private applyRepoParseEvent(event: RepoParseEvent): void {
        if (event.type === "settled") {
            this.custom.tab.updateTitle(event.data !== null ? event.data.repo : i18n.title);
        }

        if (event.type === "parsing") {
            this.uiStore.dispatch({ type: "parse/parsing" });
        } else {
            const { clearVersion, state } = this.uiStore.dispatch({ type: "parse/settled", ownerRepo: event.data });
            this.data.repoKey = state.lastParsedRepoKey;
            // 入口带入的版本与历史记录选定的版本都来自「与仓库配套的来源」，解析落定不能把它们当作用户上一次选择的版本清掉；
            // 无论是否要清空版本都先做一次判定：历史记录选定的标记要在落定时消费掉
            const pin = resolveVersionPin(normalizeRepoKey(state.lastParsedRepoKey), this.data.presetRepoKey, this.historyPickRepoKey);
            this.historyPickRepoKey = pin.historyPickRepoKey;
            if (clearVersion && !pin.keep) {
                this.clearVersionFieldAndRefreshUi();
            }
        }

        const installReady = event.type === "settled" && event.data !== null;
        this.versionUI.setRepoParseReady(installReady);
        this.syncInstallButtonDisabled();
        if (event.type === "settled") {
            this.uninstallTargets.setRepoKey(this.data.repoKey);
        }
    }

    private clearVersionFieldAndRefreshUi(): void {
        this.data.version = "";
        this.versionUI.syncDisplayFromData();
    }

    /** 复制日志纯文本；`payload` 为右键菜单打开时已算好的内容（避免点击菜单时选区丢失） */
    private async copyInstallLogPlainText(payload?: string): Promise<void> {
        const text = payload ?? installLogCopyPayloadAtOpen(this.elements.installLogEl);
        if (!text.trim()) {
            message(i18n.copyInstallLogEmpty);
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            message(i18n.copyInstallLogFailed);
        }
    }

    private async startInstall(): Promise<void> {
        if (!isRepoParseReadyForInstall(this.uiStore.getState()) || !this.data.version) {
            return;
        }
        const ownerRepo = await this.repoParser.getOwnerRepo();
        if (!ownerRepo) {
            this.log.warn(i18n.invalidUrl);
            return;
        }
        this.log.info("install package: url=[" + this.data.url + "], version=[" + this.data.version + "], enableAfterInstall=[" + this.data.enableAfterInstall + "]");
        this.uiStore.dispatch({ type: "install/started", ownerRepo });
        try {
            const result = await runInstall(
                {
                    version: this.data.version,
                    enableAfterInstall: this.data.enableAfterInstall,
                    owner: ownerRepo.owner,
                    repo: ownerRepo.repo,
                },
                this.log,
                {
                    onDownloadProgress: (loaded, total) => {
                        this.abortProgress.renderDownload(total > 0 ? loaded / total : 0);
                    },
                    onDownloadComplete: () => {
                        this.abortProgress.renderIndeterminate();
                    },
                },
            );
            if (result === true) {
                const text = i18n.installDone.replace("{ownerRepo}", `${ownerRepo.owner}/${ownerRepo.repo}`);
                this.log.info(text);
                message(text, true);
                // 刚装上的包开始参与匹配，存储目录的存在性也可能变了，重新检测一次
                this.uninstallTargets.invalidateAfterInstall();
            } else if (result === false) {
                const text = i18n.installFailed.replace("{ownerRepo}", `${ownerRepo.owner}/${ownerRepo.repo}`);
                this.log.warn(text);
                message(text);
            } else if (result === null) {
                this.log.info("User canceled download");
            }
        } finally {
            this.uiStore.dispatch({ type: "install/ended" });
            this.syncInstallButtonDisabled();
        }
    }

    /** 自定义页签关闭时由 `addTab.destroy` 调用，解除全局安装状态监听 */
    destroy(): void {
        this.destroyed = true;
        this.persistForm.cancel();
        this.uninstallTargets.destroy();
        this.versionUI.destroy();
        this.repoParser.destroy();
        this.historyMenu?.close();
        this.historyMenu = null;
        this.unsubActiveInstall?.();
        this.unsubActiveInstall = undefined;
    }
}
