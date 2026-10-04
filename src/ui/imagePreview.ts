/**
 * 缩略图的放大预览对话框
 *
 * 仓库摘要里的 icon.png / preview.png 尺寸很小，点击后用思源对话框展示原图。
 * 复用 `Dialog` 可以自动获得遮罩点击与 ESC 关闭、焦点恢复、层级与移动端适配，
 * 不必自建覆盖层（也不用引 viewerjs：只有一张图时不需要缩放 / 旋转工具条）。
 */

import { Dialog } from "siyuan";
import { escapeHtml, safeExternalUrl } from "../infra/html";

/** 当前打开的大图预览；连点时先收掉上一个，避免叠出多层同样的图 */
let currentPreview: Dialog | null = null;

/**
 * 在对话框中展示大图
 *
 * @param src 图片地址，非 http/https 时忽略（缩略图已加载成功，正常不会走到这里）
 * @param caption 文件名，用作对话框标题
 */
export function openImagePreview(src: string, caption: string): void {
    const url = safeExternalUrl(src);
    if (url === "") {
        return;
    }
    currentPreview?.destroy();
    currentPreview = null;
    const dialog = new Dialog({
        title: escapeHtml(caption),
        width: "fit-content",
        content: `<div class="b3-dialog__content jcip-image-preview"><img src="${escapeHtml(url)}" alt="" referrerpolicy="no-referrer" /></div>`,
        destroyCallback: () => {
            if (currentPreview === dialog) {
                currentPreview = null;
            }
        },
    });
    currentPreview = dialog;
}
