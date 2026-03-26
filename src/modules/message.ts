import { showMessage } from "siyuan";

let messagePrefix = "";

export function setMessagePrefix(name: string): void {
    messagePrefix = name.trim() + ": ";
}

export function message(text: string, info = false): void {
    const type = info ? "info" : "error";
    showMessage(messagePrefix + text, info ? 3000 : 10000, type);
}
