/**
 * 安装面板日志区的渲染
 *
 * 日志端口（`Logger` / `InstallLogProgress`）与无日志区时的控制台实现见 `infra/logger.ts`，
 * 这里只负责把日志行写进页面元素
 */

import { i18n } from "../infra/i18n";
import type { InstallLogProgress, Logger } from "../infra/logger";

const INSTALL_LOG_PLACEHOLDER_CLASS = "jcip-show__text--placeholder";
export const INSTALL_LOG_PROCESS_LINE_CLASS = "jcip-show__text--log";
export const INSTALL_LOG_WARN_MODIFIER_CLASS = "jcip-show__text--log-warn";
const INSTALL_LOG_PROGRESS_MODIFIER_CLASS = "jcip-show__text--log-progress";

function formatLogArg(arg: unknown): string {
    if (typeof arg === "string") {
        return arg;
    }
    if (arg instanceof Error) {
        return arg.message || String(arg);
    }
    if (typeof arg === "object" && arg !== null) {
        try {
            return JSON.stringify(arg);
        } catch {
            return String(arg);
        }
    }
    return String(arg);
}

export function createInstallLogger(installLogElement: HTMLDivElement): { log: Logger; clear: () => void } {
    /** 当前未定稿的进度行元素；追加普通日志时会被移到末尾，保证进度行始终在最后一行 */
    let progressElement: HTMLParagraphElement | null = null;

    const scrollToBottom = (): void => {
        installLogElement.scrollTop = installLogElement.scrollHeight;
    };

    const appendLine = (level: "info" | "warn", args: unknown[]): void => {
        const item = document.createElement("p");
        item.className = INSTALL_LOG_PROCESS_LINE_CLASS + (level === "warn" ? " " + INSTALL_LOG_WARN_MODIFIER_CLASS : "");
        item.textContent = args.map((arg) => formatLogArg(arg)).join(" ");
        installLogElement.append(item);
        // 进度行是「当前进行中」的信息，需始终位于日志末尾
        if (progressElement !== null) {
            installLogElement.append(progressElement);
        }
        scrollToBottom();
    };

    const log: Logger = {
        info: (...args: unknown[]) => appendLine("info", args),
        warn: (...args: unknown[]) => appendLine("warn", args),
        progress: (text: string): InstallLogProgress => {
            if (progressElement === null) {
                progressElement = document.createElement("p");
                progressElement.className =
                    INSTALL_LOG_PROCESS_LINE_CLASS + " " + INSTALL_LOG_PROGRESS_MODIFIER_CLASS;
                installLogElement.append(progressElement);
            }
            progressElement.textContent = text;
            scrollToBottom();
            const element = progressElement;
            return {
                update: (next: string): void => {
                    if (progressElement !== element) {
                        return;
                    }
                    element.textContent = next;
                    scrollToBottom();
                },
                finish: (next: string, options?: { warn?: boolean }): void => {
                    if (progressElement !== element) {
                        return;
                    }
                    element.textContent = next;
                    element.classList.remove(INSTALL_LOG_PROGRESS_MODIFIER_CLASS);
                    if (options?.warn) {
                        element.classList.add(INSTALL_LOG_WARN_MODIFIER_CLASS);
                    }
                    progressElement = null;
                    scrollToBottom();
                },
                discard: (): void => {
                    if (progressElement !== element) {
                        return;
                    }
                    element.remove();
                    progressElement = null;
                },
            };
        },
    };
    const clear = (): void => {
        progressElement = null;
        const placeholder = document.createElement("p");
        placeholder.className = INSTALL_LOG_PLACEHOLDER_CLASS;
        placeholder.textContent = i18n.installProcessPlaceholder;
        installLogElement.replaceChildren();
        installLogElement.append(placeholder);
    };
    return { log, clear };
}
