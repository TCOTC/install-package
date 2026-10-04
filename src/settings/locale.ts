/**
 * 界面语言（issue #28）
 *
 * 插件默认使用思源注入的文案（跟随思源的语言），这里的选择是一层覆盖：选择会落盘到插件私有目录，
 * 下次加载时先用思源的语言初始化，再覆盖为保存的语言；切换后重载界面，让所有已打开的页面都跟着变。
 * 只读工作空间里无法落盘，此时语言只在本次会话生效。
 */

import type { Plugin } from "siyuan";
import { localeMessages, setI18n } from "../infra/i18n";
import { fetchSyncPost } from "../infra/kernelClient";

/** 「界面语言」菜单的一项 */
export interface LocaleOption {
    lang: string;
    label: string;
}

/** 插件私有目录下的文件名 */
const STORAGE_NAME = "interface-lang";

/** 读取超时：内核不可用时 `loadData` 可能一直不兑现，不能让插件卡在加载中 */
const LOAD_TIMEOUT_MS = 2000;

/** 插件实例（由 onload 登记），用于读写保存的语言 */
let hostPlugin: Plugin | undefined;

/** 本次会话生效的语言；空串表示跟随思源 */
let activeLocale = "";

export function setLocaleHost(plugin: Plugin): void {
    hostPlugin = plugin;
}

/** 把思源的语言代码（可能带地区，如 `en-US`）归一为内置语言代码；无匹配时返回空串 */
function matchLocale(lang: string): string {
    const normalized = lang.trim().replace(/_/g, "-");
    if (localeMessages(normalized) !== undefined) {
        return normalized;
    }
    const primary = normalized.split("-")[0];
    return localeMessages(primary) !== undefined ? primary : "";
}

/** 当前生效的语言代码：优先已保存的选择，否则按思源的语言推断（供菜单显示勾选） */
export function currentLocale(): string {
    if (activeLocale !== "") {
        return activeLocale;
    }
    return matchLocale(window.siyuan.config?.lang ?? "");
}

/**
 * 「界面语言」菜单的选项
 *
 * 语言清单与名称取自思源下发的 `config.langs`（与「设置 - 外观 - 界面 - 语言」同一份数据），
 * 但只保留插件确实内置了语言包的项：列出选不了的语言只会让用户困惑。
 * 同一语言可能对应思源列表里的多项（如 `en` 与 `en-US`），按插件语言代码去重
 */
export function localeOptions(): LocaleOption[] {
    const options: LocaleOption[] = [];
    const seen = new Set<string>();
    for (const item of window.siyuan.config?.langs ?? []) {
        const lang = matchLocale(item.name);
        if (lang === "" || seen.has(lang)) {
            continue;
        }
        seen.add(lang);
        options.push({ lang, label: item.label || item.name });
    }
    return options;
}

/** 载入并应用已保存的语言；未保存过或读取失败时保持思源的语言 */
export async function applySavedLocale(plugin: Plugin): Promise<void> {
    setLocaleHost(plugin);
    const raw = await Promise.race([
        plugin.loadData(STORAGE_NAME).catch(() => ""),
        new Promise<string>((resolve) => window.setTimeout(() => resolve(""), LOAD_TIMEOUT_MS)),
    ]);
    const lang = typeof raw === "string" ? matchLocale(raw) : "";
    if (lang === "") {
        return;
    }
    applyLocale(lang);
}

/** 应用语言：模块内的 `i18n` 与插件实例的 `i18n`（命令名从这里取）同步覆盖 */
function applyLocale(lang: string): void {
    const messages = localeMessages(lang);
    if (messages === undefined) {
        return;
    }
    activeLocale = lang;
    setI18n(messages);
    if (hostPlugin !== undefined) {
        hostPlugin.i18n = messages as unknown as Plugin["i18n"];
    }
}

/**
 * 切换到指定语言并重载界面
 *
 * 只改内存中的文案不会影响已经建好的 DOM，重载界面才能让所有页面（含设置面板、页签标题）都跟着变；
 * 落盘失败（只读工作空间）时本次会话仍会切换，只是下次加载会回到思源的语言
 */
export async function switchLocale(lang: string): Promise<void> {
    if (lang === currentLocale() || localeMessages(lang) === undefined) {
        return;
    }
    if (hostPlugin !== undefined) {
        try {
            await hostPlugin.saveData(STORAGE_NAME, lang);
        } catch (error) {
            console.warn("failed to save interface language:", error);
        }
    }
    applyLocale(lang);
    await fetchSyncPost("/api/ui/reloadUI");
}
