/**
 * 集市包类型与集市 PR 标签的文案键
 *
 * 内核用复数类型名（`plugins`…），集市 PR 用单数标签名（`plugin`…）与 CI 结果标签，
 * 但展示的是同一批名称，因此只维护这一份「名称 → i18n 键」的映射
 */

import { i18n, type PluginI18n } from "./i18n";

/** 名称（内核类型的单数形式 / 集市 PR 标签名）→ i18n 键；未登记的标签名原样显示 */
const PACKAGE_LABEL_KEYS: Record<string, keyof PluginI18n> = {
    plugin: "bazaarPrLabelPlugin",
    theme: "bazaarPrLabelTheme",
    icon: "bazaarPrLabelIcon",
    widget: "bazaarPrLabelWidget",
    template: "bazaarPrLabelTemplate",
    "ci-passed": "bazaarPrLabelCIPassed",
    "ci-failed": "bazaarPrLabelCIFailed",
    "ci-skip": "bazaarPrLabelCISkip",
    "manual-review": "bazaarPrLabelManualReview",
};

/** 名称对应的界面文案；未登记的（如 Check、bug）返回原名 */
export function packageLabelText(name: string): string {
    const key = PACKAGE_LABEL_KEYS[name];
    return key === undefined ? name : i18n[key];
}
