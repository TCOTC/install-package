import { Custom, Menu, saveLayout } from "siyuan";
import { i18n } from "../infra/i18n";
import { safeExternalUrl } from "../infra/html";
import type { BazaarPullLabel } from "../github/bazaarPrs";
import { RepoParser, type RepoParseEvent, type RepoReleasesEvent } from "./repoParser";
import { abortInstall, subscribeActiveInstallChange, runInstall } from "../install/installSession";
import { getSelfPackageInfo, isSelfRepoKeySync, reportSelfInstallBlock } from "../install/selfPackage";
import { findInstalledByRepo, listInstalledPackages, type InstalledPackage } from "../install/installedPackages";
import { uninstallInstalledPackages } from "../install/uninstall";
import { getInstallPath } from "../install/install";
import { openPackageDetailPage } from "../install/packageDetail";
import { directoryExists } from "../infra/kernelClient";
import { currentInterfaceLang, interfaceLangOptions, switchInterfaceLang } from "../settings/interfaceLanguage";
import { message } from "../infra/message";
import { electron, openDirectory, toggleDevTools } from "../infra/desktop";
import { createBazaarPullLabelChip } from "./bazaarPullLabels";
import { COPY_ICON_ID, TRASHCAN_ICON_ID } from "./icons";
import { InstallProgressButton } from "./installProgressButton";
import { createInstallLogger, INSTALL_LOG_PROCESS_LINE_CLASS, type Logger } from "./logger";
import { InstallPanelUiStore, isRepoParseReadyForInstall, type InstallButtonState } from "./uiStore";
import { InstallPanelVersion } from "./version";

/** 持久化在自定义页签 layout.customModelData 中的表单（与 Custom.data 为同一引用） */
export interface InstallPanelData {
    url: string;
    version: string;
    enableAfterInstall: boolean;
    /** 最近一次成功解析的仓库键，形如 "owner/repo"；空字符串表示当前无有效仓库 */
    repoKey: string;
    /** 入口带入目标的包仓库键（小写 owner/repo）；空串表示这是顶栏入口的完整表单 */
    presetRepoKey: string;
    /** 入口带入的来源 PR 信息（JSON）；供页签重载后恢复展示 */
    presetPull: string;
    /** 入口带入的来源本地集市包信息（JSON）；供页签重载后恢复「隐藏 URL、保留版本」形态 */
    presetInstalled: string;
}

const INSTALL_PANEL_DEFAULT: InstallPanelData = {
    url: "",
    version: "",
    enableAfterInstall: true,
    repoKey: "",
    presetRepoKey: "",
    presetPull: "",
    presetInstalled: "",
};

const INSTALL_PANEL_KEYS = Object.keys(INSTALL_PANEL_DEFAULT) as (keyof InstallPanelData)[];

/** 从 layout 读出的 `custom.data` 生成标准表单对象（新对象；由调用方赋回 `custom.data`） */
export function normalizeData(raw: unknown): InstallPanelData {
    const data: Record<keyof InstallPanelData, string | boolean> = { ...INSTALL_PANEL_DEFAULT };
    if (raw && typeof raw === "object") {
        const record = raw as Record<string, unknown>;
        for (const key of INSTALL_PANEL_KEYS) {
            const value = record[key];
            const def = INSTALL_PANEL_DEFAULT[key];
            if (typeof def === "string") {
                data[key] = typeof value === "string" ? value.trim() : def;
            } else if (typeof def === "boolean") {
                data[key] = typeof value === "boolean" ? value : def;
            }
        }
    }
    return data as InstallPanelData;
}

/** 来源 PR 的展示信息（由集市 PR 页带入） */
export interface InstallPanelPull {
    number: number;
    title: string;
    htmlUrl: string;
    labels: BazaarPullLabel[];
}

/** 来源本地集市包的展示信息（由「本地集市包」页带入） */
export interface InstallPanelInstalledSource {
    /** 内核包类型（复数），用于展示 */
    kernelType: string;
    /** 包名（安装目录名） */
    name: string;
    /** 当前语言下的展示名 */
    displayName: string;
    /** 已安装版本，回填到版本栏 */
    version: string;
    /** 该包当前的启用状态，用作「安装后启用」的初始值；挂件与模板没有该状态时省略 */
    enableAfterInstall?: boolean;
}

/**
 * 由别的页签（集市 PR 页、本地集市包页）带过来的安装目标
 *
 * URL 与版本已确定，面板形态由来源决定：PR 来源隐藏 URL 与版本栏并展示 PR，
 * 本地集市包来源只隐藏 URL 栏（保留版本下拉框），并回填已安装版本
 */
export interface InstallPanelPreset {
    url: string;
    /** 目标包仓库键（`owner/repo`）；面板内统一按小写存储与比较 */
    repoKey: string;
    pull?: InstallPanelPull;
    installed?: InstallPanelInstalledSource;
}

/** 来源 PR 信息的序列化；无信息时为空串 */
function serializePull(pull: InstallPanelPull | undefined): string {
    return pull === undefined ? "" : JSON.stringify(pull);
}

/** 反序列化来源 PR 信息；内容异常时按「无信息」处理，只影响展示 */
function parsePull(raw: string): InstallPanelPull | undefined {
    if (raw === "") {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return undefined;
    }
    const pull = parsed as Partial<InstallPanelPull> | null;
    if (!pull || typeof pull.number !== "number" || typeof pull.title !== "string") {
        return undefined;
    }
    return {
        number: pull.number,
        title: pull.title,
        htmlUrl: typeof pull.htmlUrl === "string" ? pull.htmlUrl : "",
        labels: Array.isArray(pull.labels) ? pull.labels : [],
    };
}

/** 来源本地集市包信息的序列化；无信息时为空串 */
function serializeInstalled(installed: InstallPanelInstalledSource | undefined): string {
    return installed === undefined ? "" : JSON.stringify(installed);
}

/** 反序列化来源本地集市包信息；内容异常时按「无信息」处理，只影响展示与回填 */
function parseInstalled(raw: string): InstallPanelInstalledSource | undefined {
    if (raw === "") {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return undefined;
    }
    const installed = parsed as Partial<InstallPanelInstalledSource> | null;
    if (!installed || typeof installed.name !== "string" || typeof installed.kernelType !== "string") {
        return undefined;
    }
    return {
        kernelType: installed.kernelType,
        name: installed.name,
        displayName: typeof installed.displayName === "string" && installed.displayName !== "" ? installed.displayName : installed.name,
        version: typeof installed.version === "string" ? installed.version : "",
    };
}

/** 待安装面板构造时消费的预设；页签尚未创建或面板尚未初始化时先暂存于此 */
let pendingPreset: InstallPanelPreset | null = null;

/** 暂存预设，供随后创建的安装面板载入 */
export function setPendingInstallPreset(preset: InstallPanelPreset | null): void {
    pendingPreset = preset;
}

function consumePendingInstallPreset(): InstallPanelPreset | null {
    const preset = pendingPreset;
    pendingPreset = null;
    return preset;
}

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
                <input data-type="url" class="b3-text-field fn__block" value="" placeholder="https://github.com/user/repo" spellcheck="false">
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

/** 插件的存储目录（插件通过 `saveData` 等接口写入的私有目录） */
function petalDirPath(name: string): string {
    return `data/storage/petal/${name}`;
}

interface InstallPanelElements {
    inputEl: HTMLDivElement;
    urlEl: HTMLInputElement;
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
    private persistTimer: number | undefined;
    /** 仅通过 `dispatch` 修改的解析/安装面板 UI 状态管理器 */
    private readonly uiStore: InstallPanelUiStore;
    /** 页签关闭时取消订阅 */
    private unsubActiveInstall: (() => void) | undefined;
    /** 插件自身包名：卸载目标里必须把插件自身剔除 */
    private readonly pluginName: string;
    /** 与当前 URL 仓库相同的本地集市包；为空表示当前没有可卸载的目标 */
    private uninstallTargets: InstalledPackage[] | null = null;
    /** 检测序号：URL 变化或页签关闭后作废在途回调 */
    private uninstallDetectSeq = 0;
    /** 仓库键到检测结果的缓存，安装或卸载成功后失效 */
    private readonly uninstallCache = new Map<string, InstalledPackage[]>();
    /** 插件存储目录是否存在；目录由插件自己在运行时创建，故需问内核 */
    private readonly petalDirCache = new Map<string, boolean>();
    /** 存储目录检查序号：新的一次检查或页签关闭后作废在途回调 */
    private petalDirCheckSeq = 0;
    /** 页签已关闭：异步回调不再改 DOM */
    private destroyed = false;

    constructor(custom: Custom, pluginName: string) {
        this.custom = custom;
        this.pluginName = pluginName;
        this.data = this.debounceSaveLayout(normalizeData(this.custom.data));
        this.custom.data = this.data;
        // 由别的页签带过来的目标：URL 直接采用
        const preset = consumePendingInstallPreset();
        if (preset !== null) {
            this.storePreset(preset);
        }
        this.uiStore = new InstallPanelUiStore(this.data.repoKey);
        this.root = this.custom.element as HTMLElement;
        renderInstallPanel(this.root);
        this.elements = {
            inputEl: this.root.querySelector(".jcip-input") as HTMLDivElement,
            urlEl: this.root.querySelector("input[data-type='url']") as HTMLInputElement,
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
        this.data.presetRepoKey = preset.repoKey.trim().toLowerCase();
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

    /** 刚解析出的仓库是否为入口带入的那个包（两侧都小写比较） */
    private isPresetRepo(parsedRepoKey: string): boolean {
        return this.data.presetRepoKey !== "" && parsedRepoKey.toLowerCase() === this.data.presetRepoKey;
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
            this.data.url = this.elements.urlEl.value.trim();
            void this.repoParser.refresh(400);
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
                void this.uninstallMatchedPackages();
            });
        }
        for (const btn of this.elements.openDetailEls) {
            btn.addEventListener("click", () => {
                const target = this.uninstallTargets?.[0];
                if (target !== undefined) {
                    openPackageDetailPage(target);
                }
            });
        }
        // 打开文件夹针对匹配到的第一个包；同一仓库匹配到多个包时由用户按需再次打开
        for (const btn of this.elements.openPackageDirEls) {
            btn.addEventListener("click", () => {
                const target = this.uninstallTargets?.[0];
                if (target !== undefined) {
                    void openDirectory(`${getInstallPath(target.type)}/${target.name}`);
                }
            });
        }
        for (const btn of this.elements.openPetalDirEls) {
            btn.addEventListener("click", () => {
                const target = this.uninstallTargets?.[0];
                if (target?.type === "plugin") {
                    void openDirectory(`data/storage/petal/${target.name}`);
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
                    this.openLanguageMenu(button);
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

    /** 目标是否为插件自身（按包名）；自身不能卸载 */
    private isOwnPlugin(pkg: InstalledPackage): boolean {
        return pkg.type === "plugin" && pkg.name === this.pluginName;
    }

    /**
     * 按当前 URL 的仓库检测本地同仓库的集市包，决定「卸载」键的显隐
     *
     * 同一仓库可能对应多个包（实测有插件与主题元数据里写着同一个仓库地址），因此结果是个列表；
     * 检测失败时静默降级（隐藏键），不阻塞安装；只命中插件自身时也会剔光，因此不显示
     */
    private async refreshUninstallTargets(): Promise<void> {
        const seq = ++this.uninstallDetectSeq;
        const repoKey = this.data.repoKey.trim().toLowerCase();
        if (repoKey === "") {
            this.uninstallTargets = null;
            this.syncUninstallButton();
            return;
        }
        const cached = this.uninstallCache.get(repoKey);
        if (cached !== undefined) {
            this.uninstallTargets = cached;
            this.syncUninstallButton();
            return;
        }
        const packages = await listInstalledPackages(this.log);
        if (seq !== this.uninstallDetectSeq) {
            return;
        }
        if (packages === null) {
            this.uninstallTargets = null;
            this.syncUninstallButton();
            return;
        }
        const matched = findInstalledByRepo(packages, repoKey);
        const targets = matched.filter((pkg) => !this.isOwnPlugin(pkg));
        if (targets.length === 0 && matched.length > 0) {
            this.log.info(i18n.uninstallSelfExcluded);
        }
        this.uninstallCache.set(repoKey, targets);
        this.uninstallTargets = targets;
        this.syncUninstallButton();
    }

    /**
     * 有匹配到的本地集市包时显示针对该包的操作键
     *
     * 同一仓库可能匹配到多个包（实测存在），「打开文件夹」只针对第一个；
     * 存储目录只有插件才有，而且由插件自己在运行时创建，需内核确认存在后才显示入口
     */
    private syncUninstallButton(): void {
        const target = this.uninstallTargets?.[0];
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
        const storageVisible = target !== undefined && target.type === "plugin" && this.petalDirExists(target);
        for (const btn of this.elements.openPetalDirEls) {
            btn.classList.toggle("fn__none", !storageVisible);
            if (target !== undefined && target.type === "plugin") {
                btn.title = petalDirPath(target.name);
            }
        }
    }

    /**
     * 插件的存储目录是否存在
     *
     * 目录由插件自己在运行时写入（安装集市包不会建它），所以要用内核接口确认；结果按路径缓存，
     * 未知时先按「不存在」处理并触发一次检查，检查回来后重新投影操作键
     */
    private petalDirExists(target: InstalledPackage): boolean {
        const path = petalDirPath(target.name);
        const cached = this.petalDirCache.get(path);
        if (cached !== undefined) {
            return cached;
        }
        void this.detectPetalDir(path);
        return false;
    }

    /** 询问内核目录是否存在；只有最后一次检查能刷新界面，页签已关闭则丢弃结果 */
    private async detectPetalDir(path: string): Promise<void> {
        const seq = ++this.petalDirCheckSeq;
        const exists = await directoryExists(path);
        this.petalDirCache.set(path, exists);
        if (this.destroyed || seq !== this.petalDirCheckSeq) {
            return;
        }
        this.syncUninstallButton();
    }

    /** 确认后卸载与当前仓库匹配的全部本地集市包，然后重新检测 */
    private async uninstallMatchedPackages(): Promise<void> {
        // 检测结果可能已过期，执行前再剔一次插件自身
        const targets = (this.uninstallTargets ?? []).filter((pkg) => !this.isOwnPlugin(pkg));
        if (targets.length === 0) {
            return;
        }
        const allOk = await uninstallInstalledPackages(targets, this.log);
        if (allOk) {
            this.uninstallCache.clear();
        }
        await this.refreshUninstallTargets();
    }

    /**
     * 用 Proxy 包装表单：属性赋值且值变化时 400ms 防抖写入 layout。
     * 假定仅通过类型化的 `InstallPanelData` 字段写入。
     */
    private debounceSaveLayout(plain: InstallPanelData): InstallPanelData {
        return new Proxy(plain, {
            set: (target, prop, value, receiver) => {
                const prev = Reflect.get(target, prop, receiver);
                const ok = Reflect.set(target, prop, value, receiver);
                if (!ok) {
                    return false;
                }
                if (prev !== value) {
                    window.clearTimeout(this.persistTimer);
                    this.persistTimer = window.setTimeout(() => {
                        this.persistTimer = undefined;
                        saveLayout(() => {});
                    }, 400);
                }
                return true;
            },
        }) as InstallPanelData;
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
            // 入口带入的版本与仓库是同一个来源，解析落定不能把它当作用户上一次选择的版本清掉（URL 与版本栏都被隐藏，清了就无法恢复）
            if (clearVersion && !this.isPresetRepo(state.lastParsedRepoKey)) {
                this.clearVersionFieldAndRefreshUi();
            }
        }

        const installReady = event.type === "settled" && event.data !== null;
        this.versionUI.setRepoParseReady(installReady);
        this.syncInstallButtonDisabled();
        if (event.type === "settled") {
            void this.refreshUninstallTargets();
        }
    }

    private clearVersionFieldAndRefreshUi(): void {
        this.data.version = "";
        this.versionUI.syncDisplayFromData();
    }

    /**
     * 「界面语言」菜单：切换思源笔记的界面语言
     *
     * 用于快速检查集市包的 i18n：切的是整个思源界面，不只是本插件的文字；
     * 提交后由思源自行重载界面（内核广播 `setAppearance`，前端检测到 `lang` 变化后重载），插件不做重载。
     * 调用方需先 `stopPropagation`，否则菜单会被思源的全局点击处理立即收起
     */
    private openLanguageMenu(button: HTMLButtonElement): void {
        const menu = new Menu("install-package-language");
        const current = currentInterfaceLang();
        for (const option of interfaceLangOptions()) {
            menu.addItem({
                label: option.label,
                checked: option.lang === current,
                click: () => {
                    void switchInterfaceLang(option.lang);
                },
            });
        }
        const rect = button.getBoundingClientRect();
        // 菜单在按钮下方展开；下方空间不足时由思源的定位逻辑上移
        menu.open({ x: rect.left, y: rect.bottom, isLeft: false });
    }

    /** 复制日志纯文本；`payload` 为右键菜单打开时已算好的内容（避免点击菜单时选区丢失） */
    private async copyInstallLogPlainText(payload?: string): Promise<void> {
        const text = payload ?? joinAllProcessLineTexts(this.elements.installLogEl);
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
                // 刚装上的包开始参与匹配，重新检测一次
                this.uninstallCache.clear();
                // 插件可能已被内核启用并运行，存储目录的存在性要重新问一次
                this.petalDirCache.clear();
                void this.refreshUninstallTargets();
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
        this.petalDirCheckSeq++;
        window.clearTimeout(this.persistTimer);
        this.uninstallDetectSeq++;
        this.versionUI.destroy();
        this.repoParser.destroy();
        this.unsubActiveInstall?.();
        this.unsubActiveInstall = undefined;
    }
}

/**
 * 从选区 cloneContents 中只取 `.jcip-show__text--log` 内文本及行内部分选区对应的文本节点；
 * 每个完整日志行块后加单个换行；忽略占位等其它 `<p>`。
 * 跳过仅含空白字符的文本节点（多为标签外换行、缩进），并对结果首尾 trim。
 */
function plainTextFromRangeCloneContents(range: Range): string {
    const frag = range.cloneContents();
    const parts: string[] = [];
    const walk = (node: Node): void => {
        if (node.nodeType === Node.TEXT_NODE) {
            const t = node.textContent ?? "";
            if (t.trim().length === 0) {
                return;
            }
            parts.push(t.replace(/\r\n/g, "\n"));
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return;
        }
        const el = node as Element;
        if (el.classList.contains(INSTALL_LOG_PROCESS_LINE_CLASS)) {
            parts.push((el.textContent ?? "").replace(/\r\n/g, "\n"));
            parts.push("\n");
            return;
        }
        if (el.tagName === "P") {
            return;
        }
        el.childNodes.forEach(walk);
    };
    frag.childNodes.forEach(walk);
    let result = parts.join("");
    if (result.endsWith("\n")) {
        result = result.slice(0, -1);
    }
    return result.trim();
}

function joinAllProcessLineTexts(logEl: HTMLDivElement): string {
    return Array.from(logEl.querySelectorAll("." + INSTALL_LOG_PROCESS_LINE_CLASS))
        .map((el) => el.textContent ?? "")
        .join("\n")
        .trim();
}

/**
 * 右键打开菜单时：日志内有非折叠选区则只解析选区（不回落为全部行）；否则复制全部日志行。
 * 选区仅覆盖占位说明等非日志行时解析结果为空，复制将提示无可复制。
 */
function installLogCopyPayloadAtOpen(logEl: HTMLDivElement): string {
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (logEl.contains(range.startContainer) && logEl.contains(range.endContainer)) {
            return plainTextFromRangeCloneContents(range);
        }
    }
    return joinAllProcessLineTexts(logEl);
}
