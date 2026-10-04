/**
 * 界面语言（issue #28）
 *
 * 插件默认使用思源注入的文案（跟随思源的语言），这里的选择是一层覆盖：选择会落盘到插件私有目录，
 * 下次加载时先用思源的语言初始化，再覆盖为保存的语言；切换后重载界面，让所有已打开的页面都跟着变。
 * 只读工作空间里无法落盘，此时语言只在本次会话生效。
 *
 * 可选语言是思源支持的全部语言；插件没有对应语言的文案时用回退语言（`en`），
 * 这与思源加载插件 i18n 的回退链一致，也便于查看「某个语言的用户会看到什么」
 */

import type { Plugin } from "siyuan";
import { defaultLocaleMessages, localeMessages, setI18n } from "../infra/i18n";
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

/**
 * 把语言代码归一为思源语言列表里的规范写法
 *
 * 思源当前语言可能带地区（`en-US`），而语言列表里是短代码（`en`），故先精确匹配列表再退回主语言；
 * `zh-TW` 本身就是规范代码，不会被截成 `zh`（截了就落到回退语言，那是错的）。
 * 列表取不到时（异常）按插件内置语言包判断，再取不到返回空串
 */
function normalizeLang(raw: string): string {
    const code = raw.trim().replace(/_/g, "-");
    if (code === "") {
        return "";
    }
    const langs = window.siyuan.config?.langs ?? [];
    if (langs.some((item) => item.name === code)) {
        return code;
    }
    const primary = code.split("-")[0];
    if (langs.some((item) => item.name === primary)) {
        return primary;
    }
    if (localeMessages(code) !== undefined) {
        return code;
    }
    return localeMessages(primary) !== undefined ? primary : "";
}

/** 当前生效的语言代码：优先已保存的选择，否则按思源的语言推断（供菜单显示勾选） */
export function currentLocale(): string {
    if (activeLocale !== "") {
        return activeLocale;
    }
    return normalizeLang(window.siyuan.config?.lang ?? "");
}

/**
 * 「界面语言」菜单的选项：思源支持的全部语言
 *
 * 语言清单与名称取自思源下发的 `config.langs`（与「设置 - 外观 - 界面 - 语言」同一份数据），
 * **不限于插件已翻译的语言**：插件跟随思源的语言列表，选了没有对应语言包的语言时回退到 `en`
 * （与思源加载插件 i18n 的回退链一致），因此选中它就等于「该语言的用户会看到什么」
 */
export function localeOptions(): LocaleOption[] {
    const options: LocaleOption[] = [];
    const seen = new Set<string>();
    for (const item of window.siyuan.config?.langs ?? []) {
        const lang = normalizeLang(item.name);
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
    const lang = typeof raw === "string" ? normalizeLang(raw) : "";
    if (lang === "") {
        return;
    }
    applyLocale(lang);
}

/**
 * 应用语言：模块内的 `i18n` 与插件实例的 `i18n`（命令名从这里取）同步覆盖
 *
 * 该语言没有语言包时用回退语言的文案（见 `DEFAULT_LOCALE`），选择的语言本身照常生效与显示
 */
function applyLocale(lang: string): void {
    if (lang === "") {
        return;
    }
    activeLocale = lang;
    const messages = localeMessages(lang) ?? defaultLocaleMessages();
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
    const target = normalizeLang(lang);
    if (target === "" || target === currentLocale()) {
        return;
    }
    if (hostPlugin !== undefined) {
        try {
            await hostPlugin.saveData(STORAGE_NAME, target);
        } catch (error) {
            console.warn("failed to save interface language:", error);
        }
    }
    applyLocale(target);
    await fetchSyncPost("/api/ui/reloadUI");
}
