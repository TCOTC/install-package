import { Constants } from "siyuan";
import { i18n } from "./i18n";
import { message } from "./message";

declare global {
    interface Window {
        require?(moduleName: "electron"): typeof import("electron");
        require?(moduleName: string): any;
    }
}

export const electron: typeof import("electron") | undefined = (() => {
    try {
        return typeof window !== "undefined" ? window.require?.("electron") : undefined;
    } catch {
        return undefined;
    }
})();

export async function openDirectory(path: string): Promise<void> {
    if (!path || !path.trim()) {
        return;
    }
    try {
        if (!electron) {
            message(i18n.openDirectoryFailed + i18n.openDirectoryNoElectron);
            return;
        }
        const workspaceDir = (window.siyuan.config?.system.workspaceDir ?? "").trim();
        if (!workspaceDir) {
            message(i18n.openDirectoryFailed + i18n.openDirectoryNoWorkspace);
            return;
        }
        const fullPath = `${workspaceDir}/${path}`;
        if (electron.ipcRenderer) {
            electron.ipcRenderer.send(Constants.SIYUAN_CMD, {
                cmd: "openPath",
                filePath: fullPath,
            });
            return;
        }
        const openErr = await electron.shell.openPath(fullPath);
        if (openErr) {
            throw new Error(openErr);
        }
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        message(i18n.openDirectoryFailed + detail);
    }
}

export function openDevTools(): void {
    electron?.ipcRenderer?.send(Constants.SIYUAN_CMD, "openDevTools");
}
