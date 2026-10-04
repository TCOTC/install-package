/**
 * 切换思源笔记的界面语言（issue #28）
 *
 * 用途是快速检查集市包的 i18n：把整个思源界面切到目标语言，刚装上的集市包插件的文案也跟着变，
 * 而不是只换本插件的几行文字。
 *
 * 语言清单与名称取自 `window.siyuan.config.langs`（与「设置 - 外观 - 界面 - 语言」同一份数据），
 * 提交走 `/api/setting/patch`，只带 `appearance.lang`，其余外观配置由内核合并保留
 * （内核 `applyAppearanceSetting` 会写 `Conf.Lang`、重载外观并广播 `setAppearance`；
 * 前端 `applyAppearanceConfig` 检测到 `lang` 变化后会自行重载界面，插件不必自己重载）。
 */

import { i18n } from "../infra/i18n";
import { fetchSyncPost } from "../infra/kernelClient";
import { message } from "../infra/message";

/** 「界面语言」菜单的一项 */
export interface InterfaceLangOption {
    lang: string;
    label: string;
}

/**
 * 把语言代码归一为思源语言列表里的规范写法
 *
 * 当前语言可能带地区（如 `en-US`）而列表里是短代码（`en`），故先精确匹配列表再退回主语言；
 * `zh-TW` 这类本身就是规范代码，不会被截成 `zh`。
 *
 * **不在思源语言列表里的值一律视为不认识，返回空串**：内核不校验语言合法性
 * （实测 `/api/setting/patch` 提交 `not-a-lang` 也会返回 code 0 并写进配置），
 * 因此提交前必须用这份列表把关，不能让未知代码落到配置里
 */
export function normalizeInterfaceLang(raw: string): string {
    const code = raw.trim().replace(/_/g, "-");
    if (code === "") {
        return "";
    }
    const langs = window.siyuan.config?.langs ?? [];
    if (langs.some((item) => item.name === code)) {
        return code;
    }
    const primary = code.split("-")[0];
    return langs.some((item) => item.name === primary) ? primary : "";
}

/** 思源当前的界面语言（供菜单显示勾选） */
export function currentInterfaceLang(): string {
    return normalizeInterfaceLang(window.siyuan.config?.appearance?.lang ?? "");
}

/** 「界面语言」菜单的选项：思源支持的全部语言 */
export function interfaceLangOptions(): InterfaceLangOption[] {
    const options: InterfaceLangOption[] = [];
    const seen = new Set<string>();
    for (const item of window.siyuan.config?.langs ?? []) {
        const lang = normalizeInterfaceLang(item.name);
        if (lang === "" || seen.has(lang)) {
            continue;
        }
        seen.add(lang);
        options.push({ lang, label: item.label || item.name });
    }
    return options;
}

/**
 * 切换思源界面语言
 *
 * 与当前语言相同、或目标语言不在思源语言列表里时都不提交（后者会写坏配置，见 `normalizeInterfaceLang`）；
 * 成功后的重载由思源自己完成，因此这里只负责提交并处理失败
 */
export async function switchInterfaceLang(lang: string): Promise<void> {
    const target = normalizeInterfaceLang(lang);
    if (target === "" || target === currentInterfaceLang()) {
        return;
    }
    const response = await fetchSyncPost("/api/setting/patch", { appearance: { lang: target } });
    if (response.code !== 0) {
        message(i18n.switchLanguageFailed + response.msg);
    }
}
