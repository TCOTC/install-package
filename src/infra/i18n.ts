import enUS from "../i18n/en_US.json";
import zhCN from "../i18n/zh_CN.json";

type Equal<X, Y> =
    (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

type Assert<T extends true> = T;

// 强制 zh_CN.json 与 en_US.json 键集与类型一致；不匹配时仅在此处报错，避免 PluginI18n 变成 never 导致全项目刷屏
type _I18nJsonFilesMatch = Assert<Equal<typeof zhCN, typeof enUS>>;

/**
 * 与 src/i18n 下各语言 JSON 的键一致（由 zh_CN.json 推导）。
 * `& Pick<…, never>` 仅引用 _I18nJsonFilesMatch，避免「已声明但未使用」提示，不收窄类型。
 */
export type PluginI18n = typeof zhCN & Pick<{ readonly __i18nLocalesAligned: _I18nJsonFilesMatch }, never>;

// —— 运行时全局文案（入口 onload 调用 setI18n，其余模块 import { i18n }）——

/** 由 setI18n 赋值为思源注入的文案；须在 onload 调用 setI18n 之后再读 */
export let i18n!: PluginI18n;

export function setI18n(messages: PluginI18n): void {
    i18n = messages;
}
