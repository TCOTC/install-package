import { Custom, Menu, saveLayout } from "siyuan";
import { i18n } from "./i18n";
import { RepoParser } from "./repoParser";
import { runInstall } from "./installRunner";
import { message } from "./message";
import { electron, openDirectory, openDevTools } from "./desktop";

export type Logger = (...args: unknown[]) => void;

function renderInstallPanel(root: HTMLElement): void {
    root.classList.add("jcip-tab");
    const actionInstallCore = `
                <button data-type="install" type="button" class="b3-button" disabled>${i18n.installPackageButton}</button>
                <div class="jcip-action__enable">
                    <span class="jcip-action__enable-label">${i18n.enableAfterInstall}</span>
                    <input data-type="enable" type="checkbox" class="b3-switch fn__flex-center">
                </div>`;
    root.innerHTML = `
    <div class="jcip-panel">
        <div class="jcip-input">
            <section class="jcip__vflow jcip-input__field">
                <div class="jcip__label">${i18n.urlLabel}</div>
                <input data-type="url" class="b3-text-field fn__block" value="" placeholder="https://github.com/user/repo" spellcheck="false">
            </section>
            <section class="jcip__vflow jcip-input__field">
                <div class="jcip__label">${i18n.versionLabel}</div>
                <input data-type="version" class="b3-text-field fn__block" value="" placeholder="${i18n.versionPlaceholder}" spellcheck="false">
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
                    <div data-type="repo-preview">${i18n.repoPreviewTip}</div>
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

/** 持久化在自定义页签 layout.customModelData 中的表单（与 Custom.data 为同一引用） */
export interface InstallTabPanelData {
    url: string;
    version: string;
    enable: "enable" | "disable";
}

interface InstallPanelElements {
    urlInput: HTMLInputElement;
    repoPreviewEl: HTMLDivElement;
    versionInput: HTMLInputElement;
    enableCheckboxes: NodeListOf<HTMLInputElement>;
    installButtons: NodeListOf<HTMLButtonElement>;
    installLog: HTMLDivElement;
}

export interface InstallPanelCallbacks {
    openPluginSettings: () => void;
}

export class InstallPanelController {
    private readonly root: HTMLElement;
    private readonly elements: InstallPanelElements;
    private readonly panelData: InstallTabPanelData;
    private readonly log: (...args: unknown[]) => void;
    private readonly clearInstallLog: () => void;
    private readonly repoUrlController: RepoParser;
    private readonly custom: Custom;
    private readonly callbacks: InstallPanelCallbacks;
    private persistTimer: number | undefined;
    private repoParseReady = false;
    /** 安装后是否启用集市包（与两份开关 DOM 同步，持久化写入 `panelData.enable`） */
    private enableAfterInstall: boolean;

    constructor(custom: Custom, callbacks: InstallPanelCallbacks) {
        this.custom = custom;
        this.callbacks = callbacks;
        this.root = custom.element as HTMLElement;
        // TODO 支持记忆历史安装记录，增加一个按钮打开菜单可以填历史安装的仓库 URL 和版本号
        renderInstallPanel(this.root);
        this.elements = {
            urlInput: this.root.querySelector("input[data-type='url']") as HTMLInputElement,
            repoPreviewEl: this.root.querySelector("div[data-type='repo-preview']") as HTMLDivElement,
            versionInput: this.root.querySelector("input[data-type='version']") as HTMLInputElement,
            enableCheckboxes: this.root.querySelectorAll("input[data-type='enable']") as NodeListOf<HTMLInputElement>,
            installButtons: this.root.querySelectorAll("button[data-type='install']") as NodeListOf<HTMLButtonElement>,
            installLog: this.root.querySelector("div[data-type='install-log']") as HTMLDivElement,
        };
        const logger = createInstallLogger(this.elements.installLog);
        this.log = logger.log;
        this.clearInstallLog = logger.clear;
        this.panelData = normalizeInstallTabPanelData(this.custom);
        this.enableAfterInstall = this.panelData.enable === "enable";
        this.repoUrlController = new RepoParser(
            this.elements.urlInput,
            this.elements.versionInput,
            this.elements.repoPreviewEl,
            this.log,
            (repoLabel) => {
                this.custom.tab.updateTitle(repoLabel ?? i18n.title);
            },
            (ready) => {
                this.repoParseReady = ready;
                for (const btn of this.elements.installButtons) {
                    btn.disabled = !ready;
                }
                if (ready) {
                    this.persistPanelData();
                }
            }
        );
    }

    public init(): void {
        this.elements.urlInput.value = this.panelData.url;
        this.elements.versionInput.value = this.panelData.version;
        for (const cb of this.elements.enableCheckboxes) {
            cb.checked = this.enableAfterInstall;
        }

        // 立即刷新一次，用于界面重载之后初始化页签
        void this.repoUrlController.refresh();
        this.elements.urlInput.addEventListener("input", () => {
            void this.repoUrlController.refresh();
        });
        this.elements.versionInput.addEventListener("input", this.persistPanelData);
        for (const cb of this.elements.enableCheckboxes) {
            cb.addEventListener("change", () => {
                this.enableAfterInstall = cb.checked;
                for (const o of this.elements.enableCheckboxes) {
                    o.checked = this.enableAfterInstall;
                }
                this.persistPanelData();
            });
        }
        this.root.querySelector("button[data-type='refresh-repo']")?.addEventListener("click", () => {
            void this.repoUrlController.refresh();
        });

        // 回车安装
        this.elements.urlInput.addEventListener("keydown", (event) => {
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
        if (!this.elements.urlInput.value.trim()) {
            this.elements.urlInput.select();
        }

        for (const btn of this.elements.installButtons) {
            btn.addEventListener("click", () => void this.startInstall());
        }

        this.elements.installLog.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
            // 在弹出菜单瞬间确定待复制内容；点击菜单项时选区常被清空，故在此刻用 cloneContents 解析选区
            const copyPayload = installLogCopyPayloadAtOpen(this.elements.installLog);
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
                    this.callbacks.openPluginSettings();
                    break;
                default:
                    break;
            }
        });
    }

    private readonly persistPanelData = (): void => {
        if (!this.repoParseReady) {
            return;
        }
        this.panelData.url = this.elements.urlInput.value;
        this.panelData.version = this.elements.versionInput.value;
        this.panelData.enable = this.enableAfterInstall ? "enable" : "disable";

        window.clearTimeout(this.persistTimer);
        this.persistTimer = window.setTimeout(() => {
            this.persistTimer = undefined;
            saveLayout(() => {});
        }, 400);
    };

    /** 复制日志纯文本；`payload` 为右键菜单打开时已算好的内容（避免点击菜单时选区丢失） */
    private async copyInstallLogPlainText(payload?: string): Promise<void> {
        const text = payload ?? joinAllProcessLineTexts(this.elements.installLog);
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
        if (!this.repoParseReady) {
            return;
        }
        const url = this.elements.urlInput.value.trim();
        const version = this.elements.versionInput.value.trim();
        const enable = this.enableAfterInstall;
        const parsed = await this.repoUrlController.ownerRepoForUrl(url);
        if (!parsed) {
            message(i18n.invalidUrl);
            this.log(i18n.invalidUrl);
            return;
        }
        this.log("install package: url=[" + url + "], version=[" + version + "], enable=[" + enable + "]");
        await runInstall({
            version,
            enable,
            owner: parsed.owner,
            repo: parsed.repo,
        }, this.log);
    }
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

const INSTALL_LOG_PROCESS_LINE_CLASS = "jcip-show__text--log";

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

function createInstallLogger(installProcessLog: HTMLDivElement): { log: Logger; clear: () => void } {
    const clear = (): void => {
        installProcessLog.replaceChildren();
        const placeholder = document.createElement("p");
        placeholder.className = "jcip-show__text--placeholder";
        placeholder.textContent = i18n.installProcessPlaceholder;
        installProcessLog.append(placeholder);
    };
    const log: Logger = (...args: unknown[]) => {
        const text = args.map((arg) => {
            if (typeof arg === "string") {
                return arg;
            }
            if (arg instanceof Error) {
                return arg.stack || arg.message;
            }
            try {
                return JSON.stringify(arg);
            } catch {
                return String(arg);
            }
        }).join(" ");
        const item = document.createElement("p");
        item.className = INSTALL_LOG_PROCESS_LINE_CLASS;
        item.textContent = text;
        installProcessLog.append(item);
        installProcessLog.scrollTop = installProcessLog.scrollHeight;
    };
    return { log, clear };
}
