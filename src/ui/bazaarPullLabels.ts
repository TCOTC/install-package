/**
 * 集市 PR 标签的文案与胶囊渲染
 *
 * 集市 PR 页与安装面板都要展示这些标签（含 CI 状态），因此集中在此，
 * 避免同一套名称映射与颜色处理出现两份实现
 */

import { i18n, type PluginI18n } from "../infra/i18n";
import type { BazaarPullLabel } from "../github/bazaarPrs";

/** 集市 CI 托管的标签名到文案键的映射；未列出的标签（如 Check、bug）直接显示原名 */
const LABEL_TEXT_KEYS: Record<string, keyof PluginI18n> = {
    plugin: "bazaarPrLabelPlugin",
    theme: "bazaarPrLabelTheme",
    icon: "bazaarPrLabelIcon",
    template: "bazaarPrLabelTemplate",
    widget: "bazaarPrLabelWidget",
    "ci-passed": "bazaarPrLabelCIPassed",
    "ci-failed": "bazaarPrLabelCIFailed",
    "ci-skip": "bazaarPrLabelCISkip",
    "manual-review": "bazaarPrLabelManualReview",
};

export function bazaarPullLabelText(name: string): string {
    const key = LABEL_TEXT_KEYS[name];
    return key === undefined ? name : i18n[key];
}

/** 标签颜色；GitHub 返回不带 `#` 的 6 位十六进制，异常时退回次要前景色 */
function labelColor(label: BazaarPullLabel): string {
    return /^[0-9a-f]{6}$/i.test(label.color) ? `#${label.color}` : "var(--b3-theme-on-surface-light)";
}

/** 标签胶囊：色点取自标签自身颜色，两种主题下都能看清 */
export function createBazaarPullLabelChip(label: BazaarPullLabel): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "jcip-label";
    const dot = document.createElement("span");
    dot.className = "jcip-label__dot";
    dot.style.backgroundColor = labelColor(label);
    const text = document.createElement("span");
    text.textContent = bazaarPullLabelText(label.name);
    chip.append(dot, text);
    return chip;
}
