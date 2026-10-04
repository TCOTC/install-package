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
 * 插件内置的语言包；`label` 用该语言自己的写法，不随当前语言翻译
 *
 * 新增语言文件后需要在此登记（并在 `src/i18n` 下提供对应 JSON），菜单与切换都以此为准
 */
export const PLUGIN_LOCALES: ReadonlyArray<{ lang: string; label: string; messages: PluginI18n }> = [
    { lang: "zh-CN", label: "简体中文", messages: zhCN },
    { lang: "en", label: "English", messages: enUS },
];

/** 取语言代码对应的文案；未登记的语言返回 undefined */
export function localeMessages(lang: string): PluginI18n | undefined {
    return PLUGIN_LOCALES.find((item) => item.lang === lang)?.messages;
}
