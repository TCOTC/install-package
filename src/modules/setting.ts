/**
 * 插件设置面板
 */

import { Setting, type Plugin } from "siyuan";
import { i18n } from "./i18n";
import { message } from "./message";
import { decryptToken, deriveTokenVaultFileName, encryptToken } from "./tokenCrypto";

/** 内存中的明文 Token，用于设置页展示与 API；不落盘 */
let githubToken = "";
/** 本地存储的密文 Token 文件路径，用于加密保存与读取 */
let tokenStorageName = "";

export function getGitHubToken(): string {
    return githubToken;
}

/** 插件关闭时清空内存中的 Token 与缓存路径 */
export function clearRuntimeSecretCache(): void {
    githubToken = "";
    tokenStorageName = "";
}

async function getTokenStorageName(): Promise<string> {
    if (!tokenStorageName) {
        tokenStorageName = await deriveTokenVaultFileName();
    }
    return `secret/${tokenStorageName}`;
}

/**
 * 构建插件设置面板；由入口 `this.setting = createSetting(this)` 挂载
 */
export function createSetting(plugin: Plugin): Setting {

    const setting = new Setting({
        confirmCallback: async () => {
            const token = tokenInput.value.trim();
            // 删除 Token
            if (!token) {
                try {
                    await plugin.removeData(await getTokenStorageName());
                } catch {
                    message(i18n.githubTokenRemoveFailed);
                    return;
                }
                githubToken = "";
                return;
            }

            // 加密 Token 保存到磁盘
            let enc = "";
            try {
                enc = await encryptToken(token);
            } catch {
                message(i18n.githubTokenObfuscateFailed);
                return;
            }
            try {
                await plugin.saveData(await getTokenStorageName(), enc);
            } catch {
                message(i18n.githubTokenSaveFailed);
                return;
            }
            githubToken = token;
        },
    });

    // GitHub「经典」个人访问令牌创建页
    const tokenURL = "https://github.com/settings/tokens/new";
    const openPatPageButton = document.createRange().createContextualFragment(`
        <button type="button" class="b3-button b3-button--outline fn__flex-center fn__size200" title="${tokenURL}">${i18n.githubTokenOpenGithubButton}</button>
    `).firstElementChild as HTMLButtonElement | null;
    if (!openPatPageButton) {
        throw new Error("Failed to create GitHub PAT button");
    }
    openPatPageButton.addEventListener("click", () => {
        window.open(tokenURL, "_blank", "noopener,noreferrer");
    });

    const tokenInputWrapper = document.createRange().createContextualFragment(`
        <div class="b3-form__icona fn__block">
            <input id="secretKey" type="password" class="b3-text-field b3-form__icona-input"  placeholder="${i18n.githubTokenPlaceholder}" spellcheck="false" autocomplete="off">
            <svg class="b3-form__icona-icon" data-action="togglePassword" style="cursor: pointer; user-select: none;"><use xlink:href="#iconEye"></use></svg>
        </div>
    `).firstElementChild as HTMLDivElement | null;
    const tokenInput = tokenInputWrapper?.querySelector("#secretKey") as HTMLInputElement | null;
    const togglePasswordIcon = tokenInputWrapper?.querySelector("[data-action='togglePassword']") as SVGElement | null;
    if (!tokenInput || !togglePasswordIcon) {
        throw new Error("Failed to create token input elements");
    }
    togglePasswordIcon.addEventListener("click", () => {
        tokenInput.type = tokenInput.type === "password" ? "text" : "password";
    });

    setting.addItem({
        title: i18n.githubTokenHelpTitle,
        description: i18n.githubTokenSettingDesc,
        direction: "row",
        actionElement: openPatPageButton,
    });
    setting.addItem({
        title: i18n.githubTokenPasteTitle,
        direction: "row",
        createActionElement: () => {
            tokenInput.value = githubToken;
            return tokenInputWrapper;
        },
    });

    return setting;
}

/** 从磁盘恢复已保存的设置到运行时 */
export async function loadSetting(plugin: Plugin): Promise<void> {
    try {
        githubToken = "";
        // 从磁盘加载 Token
        const data: unknown = await plugin.loadData(await getTokenStorageName());
        if (typeof data !== "string" || !data.trim()) {
            return;
        }
        // 解密 Token
        const token = await decryptToken(data.trim());
        if (token === null) {
            message(i18n.githubTokenDecryptFailed);
            return;
        }
        githubToken = token;
    } catch {
        /* 首次启用或无历史数据时忽略 */
    }
}
