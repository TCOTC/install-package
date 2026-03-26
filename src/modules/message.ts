import { showMessage } from "siyuan";

let messagePrefix = "";

export function setMessagePrefix(name: string): void {
    messagePrefix = name.trim();
}

/** 思源通知：错误类消息展示更久 */
export function message(text: string, isError?: boolean): void {
    const type = isError ? "error" : "info";
    const label = messagePrefix ? messagePrefix + ": " + text : text;
    showMessage(label, isError ? 10000 : 3000, type);
}
