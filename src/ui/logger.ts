import { i18n } from "../infra/i18n";

/** 安装日志：`log.info` 为普通行，`log.warn` 为告警行 */
export type Logger = {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
};

const INSTALL_LOG_PLACEHOLDER_CLASS = "jcip-show__text--placeholder";
export const INSTALL_LOG_PROCESS_LINE_CLASS = "jcip-show__text--log";
export const INSTALL_LOG_WARN_MODIFIER_CLASS = "jcip-show__text--log-warn";

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
    const appendLine = (level: "info" | "warn", args: unknown[]): void => {
        const item = document.createElement("p");
        item.className = INSTALL_LOG_PROCESS_LINE_CLASS + (level === "warn" ? " " + INSTALL_LOG_WARN_MODIFIER_CLASS : "");
        item.textContent = args.map((arg) => formatLogArg(arg)).join(" ");
        installLogElement.append(item);
        installLogElement.scrollTop = installLogElement.scrollHeight;
    };
    const log: Logger = {
        info: (...args: unknown[]) => appendLine("info", args),
        warn: (...args: unknown[]) => appendLine("warn", args),
    };
    const clear = (): void => {
        const placeholder = document.createElement("p");
        placeholder.className = INSTALL_LOG_PLACEHOLDER_CLASS;
        placeholder.textContent = i18n.installProcessPlaceholder;
        installLogElement.replaceChildren();
        installLogElement.append(placeholder);
    };
    return { log, clear };
}
