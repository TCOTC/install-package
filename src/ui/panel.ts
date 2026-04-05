import { Custom, Menu, saveLayout } from "siyuan";
import { i18n } from "../infra/i18n";
import { RepoParser } from "./repoParser";
import {
    abortInstall,
    isRepoInstalling,
    isSameTargetInstalling,
    subscribeActiveInstallChange,
    runInstall,
} from "../install/installSession";
import { message } from "../infra/message";
import { electron, openDirectory, openDevTools } from "../infra/desktop";
import type { InstallPanelData, Logger } from "../types";

const INSTALL_PANEL_DEFAULT: InstallPanelData = {
    url: "",
    version: "",
    enableAfterInstall: true,
};

const INSTALL_PANEL_KEYS = Object.keys(INSTALL_PANEL_DEFAULT) as (keyof InstallPanelData)[];

function isDataEqual(a: InstallPanelData, b: InstallPanelData): boolean {
    return INSTALL_PANEL_KEYS.every((k) => a[k] === b[k]);
}

/** 标准化自定义页签数据，确保数据格式正确 */
export function normalizeData(custom: Custom): InstallPanelData {
    const data: Record<keyof InstallPanelData, string | boolean> = { ...INSTALL_PANEL_DEFAULT };
    if (custom.data && typeof custom.data === "object") {
        const raw = custom.data as Record<string, unknown>;
        for (const key of INSTALL_PANEL_KEYS) {
            const value = raw[key];
            const def = INSTALL_PANEL_DEFAULT[key];
            if (typeof def === "string") {
                data[key] = typeof value === "string" ? value.trim() : def;
            } else if (typeof def === "boolean") {
                data[key] = typeof value === "boolean" ? value : def;
            }
        }
    }
    custom.data = data;
    return data as InstallPanelData;
}

function renderInstallPanel(root: HTMLElement): void {
    root.classList.add("jcip-tab");
    const actionInstallCore = `
                <button data-type="install" type="button" class="b3-button" disabled>${i18n.installPackageButton}</button>
                <button data-type="abort-install" type="button" class="b3-button fn__none">${i18n.abortInstallButton}</button>
                <div class="jcip-action__enable">
                    <span class="jcip-action__enable-label">${i18n.enableAfterInstall}</span>
                    <input data-type="enableAfterInstall" type="checkbox" class="b3-switch fn__flex-center">
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
    versionEl: HTMLInputElement;
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
    /** 上次已写入 layout 的数据快照，与 `this.data` 一致时不调用 `saveLayout` */
    private dataSnapshot: InstallPanelData;
    private persistTimer: number | undefined;
    private repoParseReady = false;
    private installButtonSyncSeq = 0;
    /**
     * 本面板当前 `await runInstall` 对应的仓库。与输入框解析解耦，用于中止本面板发起的安装。
     * 在 `runInstall` 返回（成功 / 失败 / 中止）后于 `finally` 中清空。
     */
    private panelInstallContext: { owner: string; repo: string } | null = null;
    /** 页签关闭时取消订阅 */
    private unsubActiveInstall: (() => void) | undefined;

    constructor(custom: Custom, openPluginSettings: () => void) {
        this.custom = custom;
        this.data = normalizeData(this.custom);
        this.dataSnapshot = { ...this.data };
        this.root = this.custom.element as HTMLElement;
        renderInstallPanel(this.root);
        this.elements = {
            urlEl: this.root.querySelector("input[data-type='url']") as HTMLInputElement,
            versionEl: this.root.querySelector("input[data-type='version']") as HTMLInputElement,
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
        this.repoParser = new RepoParser(
            this.data,
            this.log,
            this.elements.repoInfoEl,
            (repoLabel) => {
                this.custom.tab.updateTitle(repoLabel ?? i18n.title);
            },
            (ready) => {
                this.repoParseReady = ready;
                this.syncInstallButtonDisabled();
                if (ready) {
                    this.persistPanelData();
                }
            },
        );
        this.unsubActiveInstall = subscribeActiveInstallChange(() => this.syncInstallButtonDisabled());

        this.init();
    }

    private init(): void {
        this.elements.urlEl.value = this.data.url;
        this.elements.versionEl.value = this.data.version;
        for (const cb of this.elements.enableAfterInstallSwitchEls) {
            cb.checked = this.data.enableAfterInstall;
        }

        // 从输入框单向同步到 `this.data`（trim），不回写 `value`；`RepoParser` / 持久化均读 `this.data`
        this.data.url = this.elements.urlEl.value.trim();
        this.data.version = this.elements.versionEl.value.trim();
        // 立即刷新一次，用于界面重载之后初始化页签
        void this.repoParser.refresh();
        this.elements.urlEl.addEventListener("input", () => {
            this.data.url = this.elements.urlEl.value.trim();
            void this.repoParser.refresh(300);
        });
        this.elements.versionEl.addEventListener("input", () => {
            this.data.version = this.elements.versionEl.value.trim();
            // TODO 支持通过版本号查询 Release 信息显示在 Info 区域中
            // await this.repoParser.refresh();
            // 到时候要删除下面这行，因为 refresh() 之后会自动 persistPanelData()
            this.persistPanelData();
        });
        for (const cb of this.elements.enableAfterInstallSwitchEls) {
            cb.addEventListener("change", () => {
                this.data.enableAfterInstall = cb.checked;
                for (const o of this.elements.enableAfterInstallSwitchEls) {
                    o.checked = cb.checked;
                }
                this.persistPanelData();
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

    private syncInstallButtonDisabled(): void {
        const isPanelRepoInstalling = (): boolean => {
            const c = this.panelInstallContext;
            return c !== null && isRepoInstalling(c.owner, c.repo);
        };
        const setInstallDisabled = (d: boolean): void => {
            for (const b of this.elements.installEls) {
                b.disabled = d;
            }
        };

        // 解析新 URL 时 `repoParseReady` 会暂时为 false，但不能因此隐藏「中断安装」按钮，所以先判断是否正在安装
        if (isPanelRepoInstalling()) {
            this.installButtonSyncSeq++;
            setInstallDisabled(true);
            this.setInstallAbortButtonVisibility(true);
            return;
        }
        if (!this.repoParseReady) {
            this.installButtonSyncSeq++;
            setInstallDisabled(true);
            this.setInstallAbortButtonVisibility(false);
            return;
        }
        const seq = ++this.installButtonSyncSeq;
        void (async (): Promise<void> => {
            if (isPanelRepoInstalling()) {
                if (seq !== this.installButtonSyncSeq) {
                    return;
                }
                this.setInstallAbortButtonVisibility(true);
                return;
            }
            const ownerRepo = await this.repoParser.getOwnerRepo();
            if (seq !== this.installButtonSyncSeq) {
                return;
            }
            this.setInstallAbortButtonVisibility(false);
            const ok =
                this.repoParseReady &&
                ownerRepo !== null &&
                !isSameTargetInstalling(ownerRepo.owner, ownerRepo.repo, this.data.version);
            setInstallDisabled(!ok);
        })();
    }

    /** 中止本面板发起的安装 */
    private abortCurrentRepoInstall(): void {
        const ctx = this.panelInstallContext;
        if (ctx === null) {
            return;
        }
        abortInstall(ctx.owner, ctx.repo);
    }

    private readonly persistPanelData = (): void => {
        if (!this.repoParseReady) {
            return;
        }

        window.clearTimeout(this.persistTimer);
        this.persistTimer = window.setTimeout(() => {
            this.persistTimer = undefined;
            if (isDataEqual(this.data, this.dataSnapshot)) {
                return;
            }
            this.dataSnapshot = { ...this.data };
            saveLayout(() => {});
        }, 400);
    };

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
        if (!this.repoParseReady) {
            return;
        }
        const ownerRepo = await this.repoParser.getOwnerRepo();
        if (!ownerRepo) {
            this.log.warn(i18n.invalidUrl);
            return;
        }
        const version = this.data.version;
        const enableAfterInstall = this.data.enableAfterInstall;
        this.log.info("install package: url=[" + this.data.url + "], version=[" + this.data.version + "], enableAfterInstall=[" + enableAfterInstall + "]");
        this.panelInstallContext = { owner: ownerRepo.owner, repo: ownerRepo.repo };
        try {
            const result = await runInstall(
                {
                    version,
                    enableAfterInstall,
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
            this.panelInstallContext = null;
            this.syncInstallButtonDisabled();
        }
    }

    /** 自定义页签关闭时由 `addTab.destroy` 调用，解除全局安装状态监听 */
    destroy(): void {
        window.clearTimeout(this.persistTimer);
        this.repoParser.destroy();
        this.unsubActiveInstall?.();
        this.unsubActiveInstall = undefined;
    }
}

const INSTALL_LOG_PROCESS_LINE_CLASS = "jcip-show__text--log";
const INSTALL_LOG_WARN_MODIFIER_CLASS = "jcip-show__text--log-warn";

/** 将不同类型的参数转换为字符串 */
function formatLogArg(arg: unknown): string {
    if (typeof arg === "string") {
        return arg;
    }
    if (arg instanceof Error) {
        return arg.message || String(arg);
    }
    if (typeof arg === "object" && arg !== null) {
        try {
            return JSON.stringify(arg);
        } catch {
            return String(arg);
        }
    }
    return String(arg);
}

function createInstallLogger(installLogElement: HTMLDivElement): { log: Logger; clear: () => void } {
    const appendLine = (level: "info" | "warn", args: unknown[]): void => {
        const item = document.createElement("p");
        item.className =
            INSTALL_LOG_PROCESS_LINE_CLASS + (level === "warn" ? " " + INSTALL_LOG_WARN_MODIFIER_CLASS : "");
        item.textContent = args.map((arg) => formatLogArg(arg)).join(" ");
        installLogElement.append(item);
        installLogElement.scrollTop = installLogElement.scrollHeight;
    };
    const log: Logger = {
        info: (...args: unknown[]) => appendLine("info", args),
        warn: (...args: unknown[]) => appendLine("warn", args),
    };
    const clear = (): void => {
        installLogElement.replaceChildren();
        const placeholder = document.createElement("p");
        placeholder.className = "jcip-show__text--placeholder";
        placeholder.textContent = i18n.installProcessPlaceholder;
        installLogElement.append(placeholder);
    };
    return { log, clear };
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
