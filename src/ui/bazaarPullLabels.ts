/**
 * 集市 PR 标签的胶囊渲染
 *
 * 集市 PR 页与安装面板都要展示这些标签（含 CI 状态），因此集中在此，
 * 标签名的文案映射见 `infra/packageLabels.ts`
 */

import { packageLabelText } from "../infra/packageLabels";
import type { BazaarPullLabel } from "../github/bazaarPrs";

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
    text.textContent = packageLabelText(label.name);
    chip.append(dot, text);
    return chip;
}
