import { Custom, Menu, saveLayout } from "siyuan";
import { i18n } from "../infra/i18n";
import { RepoParser, type RepoParseEvent, type RepoReleasesEvent } from "./repoParser";
import { abortInstall, subscribeActiveInstallChange, runInstall } from "../install/installSession";
import { message } from "../infra/message";
import { electron, openDirectory, openDevTools } from "../infra/desktop";
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
}

const INSTALL_PANEL_DEFAULT: InstallPanelData = {
    url: "",
    version: "",
    enableAfterInstall: true,
    repoKey: "",
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

function renderInstallPanel(root: HTMLElement): void {
    root.classList.add("jcip-tab");
    const actionInstallCore = `
                <button data-type="install" type="button" class="b3-button" disabled>${i18n.installPackageButton}</button>
                <button data-type="abort-install" type="button" class="b3-button fn__none">${i18n.abortInstallButton}</button>
                <label class="jcip-action__enable">
                    <span class="jcip-action__enable-label">${i18n.enableAfterInstall}</span>
                    <input data-type="enableAfterInstall" type="checkbox" class="b3-switch fn__flex-center">
                </label>`;
    root.innerHTML = `
    <div class="jcip-panel">
        <div class="jcip-input">
            <section class="jcip__vflow jcip-input__field">
                <div class="jcip__label">${i18n.urlLabel}</div>
                <input data-type="url" class="b3-text-field fn__block" value="" placeholder="https://github.com/user/repo" spellcheck="false">
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
                <div class="jcip__vflow jcip-show__card">
                    <p class="jcip-show__text--placeholder">${i18n.packageInfoPlaceholder}</p>
                    <div data-type="repo-info">${i18n.repoInfoTip}</div>
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
                <button data-type="open-devtools" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}">${i18n.openDevTools}</button>
                <button data-type="open-directory" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}" title="data/plugins">${i18n.openPluginsDir}</button>
                <button data-type="open-directory" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}" title="data/storage/petal">${i18n.openPetalDir}</button>
                <button data-type="open-directory" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}" title="conf/appearance/themes">${i18n.openThemesDir}</button>
                <button data-type="open-directory" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}" title="conf/appearance/icons">${i18n.openIconsDir}</button>
                <button data-type="open-directory" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}" title="data/widgets">${i18n.openWidgetsDir}</button>
                <button data-type="open-directory" type="button" class="b3-button b3-button--outline${electron ? "" : " fn__none"}" title="data/templates">${i18n.openTemplatesDir}</button>
                <button data-type="open-settings" type="button" class="b3-button b3-button--outline">${i18n.openPluginSettings}</button>
            </div>
        </div>
    </div>`;
}

interface InstallPanelElements {
    urlEl: HTMLInputElement;
    versionEl: HTMLButtonElement;
    repoInfoEl: HTMLDivElement;
    enableAfterInstallSwitchEls: NodeListOf<HTMLInputElement>;
    installEls: NodeListOf<HTMLButtonElement>;
    abortEls: NodeListOf<HTMLButtonElement>;
    installLogEl: HTMLDivElement;
}

export class InstallPanel {
    private readonly custom: Custom;
    private readonly data: InstallPanelData;
    private readonly root: HTMLElement;
    private readonly elements: InstallPanelElements;
    private readonly log: Logger;
    private readonly clearInstallLog: () => void;
    private readonly openPluginSettings: () => void;
    private readonly repoParser: RepoParser;
    private readonly versionUI: InstallPanelVersion;
    private persistTimer: number | undefined;
    /** 仅通过 `dispatch` 修改的解析/安装面板 UI 状态管理器 */
    private readonly uiStore: InstallPanelUiStore;
    /** 页签关闭时取消订阅 */
    private unsubActiveInstall: (() => void) | undefined;

    constructor(custom: Custom, openPluginSettings: () => void) {
        this.custom = custom;
        this.data = this.debounceSaveLayout(normalizeData(this.custom.data));
        this.custom.data = this.data;
        this.uiStore = new InstallPanelUiStore(this.data.repoKey);
        this.root = this.custom.element as HTMLElement;
        renderInstallPanel(this.root);
        this.elements = {
            urlEl: this.root.querySelector("input[data-type='url']") as HTMLInputElement,
            versionEl: this.root.querySelector("[data-type='version']") as HTMLButtonElement,
            repoInfoEl: this.root.querySelector("div[data-type='repo-info']") as HTMLDivElement,
            enableAfterInstallSwitchEls: this.root.querySelectorAll("input[data-type='enableAfterInstall']") as NodeListOf<HTMLInputElement>,
            installEls: this.root.querySelectorAll("button[data-type='install']") as NodeListOf<HTMLButtonElement>,
            abortEls: this.root.querySelectorAll("button[data-type='abort-install']") as NodeListOf<HTMLButtonElement>,
            installLogEl: this.root.querySelector("div[data-type='install-log']") as HTMLDivElement,
        };
        const logger = createInstallLogger(this.elements.installLogEl);
        this.log = logger.log;
        this.clearInstallLog = logger.clear;
        this.openPluginSettings = openPluginSettings;
        this.versionUI = new InstallPanelVersion(this.data, this.elements.versionEl, this.log, {
            onPickedVersion: this.syncInstallButtonDisabled.bind(this),
        });
        this.repoParser = new RepoParser(this.data, this.log, this.elements.repoInfoEl, {
            onRepoParseEvent: this.applyRepoParseEvent.bind(this),
            onRepoReleasesEvent: this.applyRepoReleasesEvent.bind(this),
        });
        this.unsubActiveInstall = subscribeActiveInstallChange(() => this.syncInstallButtonDisabled());

        this.init();
    }

    private init(): void {
        this.elements.urlEl.value = this.data.url;
        this.versionUI.syncVersionDisplay();
        for (const cb of this.elements.enableAfterInstallSwitchEls) {
            cb.checked = this.data.enableAfterInstall;
        }

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

        this.elements.installLogEl.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
            // 在弹出菜单瞬间确定待复制内容；点击菜单项时选区常被清空，故在此刻用 cloneContents 解析选区
            const copyPayload = installLogCopyPayloadAtOpen(this.elements.installLogEl);
            const menu = new Menu("install-package-install-log");
            menu.addItem({
                icon: "iconCopy",
                label: i18n.copyInstallLog,
                click: () => {
                    void this.copyInstallLogPlainText(copyPayload);
                },
            });
            menu.addItem({
                icon: "iconTrashcan",
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
                case "open-devtools":
                    openDevTools();
                    break;
                case "open-directory":
                    await openDirectory(button.title);
                    break;
                case "open-settings":
                    this.openPluginSettings();
                    break;
                default:
                    break;
            }
        });
    }

    private setInstallAbortButtonVisibility(installing: boolean): void {
        for (const b of this.elements.installEls) {
            b.classList.toggle("fn__none", installing);
        }
        for (const b of this.elements.abortEls) {
            b.classList.toggle("fn__none", !installing);
        }
    }

    private applyInstallButtonState(phase: InstallButtonState): void {
        const installDisabled = phase !== "canInstall";
        for (const b of this.elements.installEls) {
            b.disabled = installDisabled;
        }
        this.setInstallAbortButtonVisibility(phase === "installing");
    }

    /** 安装区三态由 `uiStore.syncInstallButtonState` / `resolveInstallButtonState` 统一推导 */
    private syncInstallButtonDisabled(): void {
        this.uiStore.syncInstallButtonState({
            getSelectedVersion: () => this.data.version,
            resolveOwnerRepo: () => this.repoParser.getOwnerRepo(),
            apply: (state) => this.applyInstallButtonState(state),
        });
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
            if (clearVersion) {
                this.clearVersionFieldAndRefreshUi();
            }
        }

        const installReady = event.type === "settled" && event.data !== null;
        this.versionUI.setRepoParseReady(installReady);
        this.syncInstallButtonDisabled();
    }

    private clearVersionFieldAndRefreshUi(): void {
        this.data.version = "";
        this.versionUI.syncDisplayFromData();
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
            );
            if (result === true) {
                const text = i18n.installDone.replace("{ownerRepo}", `${ownerRepo.owner}/${ownerRepo.repo}`);
                this.log.info(text);
                message(text, true);
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
        window.clearTimeout(this.persistTimer);
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
