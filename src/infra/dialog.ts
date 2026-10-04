/**
 * 确定/取消对话框
 *
 * 插件里几处「问一句再继续」的交互（大文件下载确认、卸载确认、GitHub 鉴权提示）
 * 结构完全相同：标题 + 正文 + 取消/确认键，确认后调用方继续。
 * 这里统一实现，避免各处的按钮接线、`destroyCallback` 收尾与 Promise 结算各写一份
 */

import { Dialog } from "siyuan";
import { i18n } from "./i18n";

export interface ConfirmDialogOptions {
    title: string;
    /** 正文 HTML；外部来源的内容由调用方自行转义 */
    content: string;
    /** 对话框宽度；缺省为桌面 480px / 移动端 92vw */
    width?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** 为 false 时不渲染「取消」键，只有「确认」（如提示类对话框） */
    showCancel?: boolean;
    /** 对话框创建后回调，供调用方登记单例 */
    onCreated?: (dialog: Dialog) => void;
    /** 对话框销毁后回调，供调用方清空单例 */
    onClosed?: () => void;
    /** 点「确认」后回调（此时对话框已销毁） */
    onConfirm?: () => void;
}

/** 弹出确定对话框；确认返回 true，取消或直接关闭返回 false */
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
    const cancelButton = options.showCancel === false
        ? ""
        : `<button data-type="cancel" class="b3-button b3-button--cancel">${options.cancelLabel ?? i18n.cancel}</button><div class="fn__space"></div>`;
    return new Promise((resolve) => {
        let confirmed = false;
        const dialog = new Dialog({
            title: options.title,
            width: options.width ?? (window.siyuan.mobile ? "92vw" : "480px"),
            content:
                `<div class="b3-dialog__content">
                    ${options.content}
                </div>
                <div class="b3-dialog__action">
                    ${cancelButton}<button data-type="confirm" class="b3-button b3-button--text">${options.confirmLabel ?? i18n.confirm}</button>
                </div>`,
            destroyCallback: () => {
                options.onClosed?.();
                resolve(confirmed);
            },
        });
        options.onCreated?.(dialog);
        dialog.element.querySelector("button[data-type='cancel']")?.addEventListener("click", () => {
            dialog.destroy();
        });
        dialog.element.querySelector("button[data-type='confirm']")?.addEventListener("click", () => {
            confirmed = true;
            dialog.destroy();
            options.onConfirm?.();
        });
    });
}
