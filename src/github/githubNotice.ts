import { Dialog } from "siyuan";
import { i18n } from "../infra/i18n";
import { confirmDialog } from "../infra/dialog";
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

/**
 * 提示类对话框：登记为单例，点「确认」后打开插件设置
 *
 * 令牌失效只给「确定」（唯一有意义的下步操作就是去设置里重填），限流则另有「取消」
 */
function showAuthNotice(title: string, content: string, width: string, showCancel: boolean): void {
    // 让触发请求的输入框失焦，避免对话框与它的原生提示叠加
    (document.activeElement as HTMLElement | null)?.blur();
    void confirmDialog({
        title,
        width,
        content: `<div class="b3-label__text">${content}</div>`,
        showCancel,
        onCreated: (dialog) => {
            sharedGitHubNoticeDialog = dialog;
        },
        onClosed: () => {
            sharedGitHubNoticeDialog = null;
        },
        onConfirm: () => openPluginSettingsHandler?.(),
    });
}

export function showGitHubAuthNotice(status: number): void {
    if (sharedGitHubNoticeDialog) {
        return;
    }

    // Token 无效或过期
    if (status === 401) {
        showAuthNotice(
            i18n.githubTokenExpiredTitle,
            i18n.githubTokenExpiredContent,
            window.siyuan.mobile ? "92vw" : "480px",
            false,
        );
        return;
    }

    // 接口限流：没有 Token 时提示去设置里填写，以便提高限额
    if (status === 403 && !getGitHubToken()) {
        showAuthNotice(
            i18n.githubRateLimitDialogTitle,
            i18n.githubRateLimitDialogContent,
            window.siyuan.mobile ? "92vw" : "520px",
            true,
        );
    }
}
