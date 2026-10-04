import enUS from "../i18n/en.json";
import zhCN from "../i18n/zh-CN.json";

type Equal<X, Y> =
    (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

type Assert<T extends true> = T;

// 强制 zh-CN.json 与 en.json 键集与类型一致；不匹配时仅在此处报错，避免 PluginI18n 变成 never 导致全项目刷屏
type _I18nJsonFilesMatch = Assert<Equal<typeof zhCN, typeof enUS>>;

/**
 * 与 src/i18n 下各语言 JSON 的键一致（由 zh-CN.json 推导）。
 * `& Pick<…, never>` 仅引用 _I18nJsonFilesMatch，避免「已声明但未使用」提示，不收窄类型。
 */
export type PluginI18n = typeof zhCN & Pick<{ readonly __i18nLocalesAligned: _I18nJsonFilesMatch }, never>;

// —— 运行时全局文案（入口 onload 调用 setI18n，其余模块 import { i18n }）——

/** 由 setI18n 赋值为思源注入的文案；须在 onload 调用 setI18n 之后再读 */
export let i18n!: PluginI18n;

export function setI18n(messages: PluginI18n): void {
    i18n = messages;
}

// —— 内置语言包（供「界面语言」菜单切换，用于快速检查插件的 i18n）——

/**
 * 插件内置的语言包
 *
 * 这里登记「插件随身带了哪些语言包的文案」，不是菜单能选哪些语言：菜单列出的是思源支持的全部语言
 * （`window.siyuan.config.langs`，与「设置 - 外观 - 界面 - 语言」同一份数据）。
 * 往 `src/i18n` 下新增 JSON 后在此登记，对应语言的用户就会拿到它
 */
export const PLUGIN_LOCALES: ReadonlyArray<{ lang: string; messages: PluginI18n }> = [
    { lang: "zh-CN", messages: zhCN },
    { lang: "en", messages: enUS },
];

/** 取语言代码对应的文案；未登记的语言返回 undefined（调用方需自行回退） */
export function localeMessages(lang: string): PluginI18n | undefined {
    return PLUGIN_LOCALES.find((item) => item.lang === lang)?.messages;
}

/**
 * 回退语言
 *
 * 与思源加载插件 i18n 的回退链一致（`Conf.Lang` → 旧名 → `en` → `zh-CN`）：
 * 插件没有对应语言的文案时用 `en`，菜单里选一个没有语言包的语言也就相当于「该语言的用户会看到什么」
 */
export const DEFAULT_LOCALE = "en";

/** 回退语言的文案；登记表为空时取第一个，实际不会缺 */
export function defaultLocaleMessages(): PluginI18n {
    return localeMessages(DEFAULT_LOCALE) ?? PLUGIN_LOCALES[0].messages;
}
