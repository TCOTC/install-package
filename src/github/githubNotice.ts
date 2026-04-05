import { Dialog } from "siyuan";
import { i18n } from "../infra/i18n";
import { getGitHubToken } from "../settings/setting";

/** GitHub 相关通知对话框单例 */
let sharedGitHubNoticeDialog: Dialog | null = null;
let openPluginSettingsHandler: (() => void) | null = null;

export function setOpenPluginSettingsHandler(handler: () => void): void {
    openPluginSettingsHandler = handler;
}

/** 插件关闭时：关掉可能仍打开的 GitHub 提示框，并清空打开设置的回调，避免仍调用已失效的插件实例 */
export function destroyGitHubNotice(): void {
    openPluginSettingsHandler = null;
    if (sharedGitHubNoticeDialog) {
        sharedGitHubNoticeDialog.destroy();
        sharedGitHubNoticeDialog = null;
    }
}

export function showGitHubAuthNotice(status: number): void {
    if (sharedGitHubNoticeDialog) {
        return;
    }

    // Token 无效或过期
    if (status === 401) {
        (document.activeElement as HTMLElement | null)?.blur();
        const dialog = new Dialog({
            title: i18n.githubTokenExpiredTitle,
            width: window.siyuan.mobile ? "92vw" : "480px",
            content:
                `<div class="b3-dialog__content">
                    <div class="b3-label__text">${i18n.githubTokenExpiredContent}</div>
                </div>
                <div class="b3-dialog__action">
                    <button data-type="confirm" class="b3-button b3-button--text">${i18n.confirm}</button>
                </div>`,
            destroyCallback: () => {
                sharedGitHubNoticeDialog = null;
            },
        });
        sharedGitHubNoticeDialog = dialog;
        dialog.element.querySelector("button[data-type='confirm']")?.addEventListener("click", () => {
            dialog.destroy();
            openPluginSettingsHandler?.();
        });
        return;
    }

    // 接口限流
    if (status === 403 && !getGitHubToken()) {
        (document.activeElement as HTMLElement | null)?.blur();
        const dialog = new Dialog({
            title: i18n.githubRateLimitDialogTitle,
            width: window.siyuan.mobile ? "92vw" : "520px",
            content:
                `<div class="b3-dialog__content">
                    <div class="b3-label__text">${i18n.githubRateLimitDialogContent}</div>
                </div>
                <div class="b3-dialog__action">
                    <button data-type="cancel" class="b3-button b3-button--cancel">${i18n.cancel}</button><div class="fn__space"></div>
                    <button data-type="confirm" class="b3-button b3-button--text">${i18n.confirm}</button>
                </div>`,
            destroyCallback: () => {
                sharedGitHubNoticeDialog = null;
            },
        });
        sharedGitHubNoticeDialog = dialog;
        dialog.element.querySelector("button[data-type='cancel']")?.addEventListener("click", () => {
            dialog.destroy();
        });
        dialog.element.querySelector("button[data-type='confirm']")?.addEventListener("click", () => {
            dialog.destroy();
            openPluginSettingsHandler?.();
        });
    }
}
