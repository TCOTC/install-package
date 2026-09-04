/**
 * 插件设置面板
 */

import { Setting, type Plugin } from "siyuan";
import { i18n } from "../infra/i18n";
import { message } from "../infra/message";
import { createTokenVault, seedFromSiyuanSystem } from "siyuan-token-vault";
import type { TokenVault } from "siyuan-token-vault";

/**
 * 模块级 Token Vault 单例（首次使用时按当前插件实例惰性初始化）
 * 内存中的明文 Token 由 vault 维护（cachedToken），不单独落盘；插件关闭时 clear 即可
 */
let tokenVault: TokenVault | undefined;

/**
 * 获取（或惰性创建）Token Vault
 * 密钥派生种子绑定当前工作空间与设备特征：换设备或换工作空间后 seed 变化，
 * 旧密文无法解密（文件名亦随之变化，视为未保存），需在新环境重新配置 Token
 */
function getTokenVault(plugin: Plugin): TokenVault {
    if (!tokenVault) {
        const seed = seedFromSiyuanSystem(window.siyuan.config?.system);
        tokenVault = createTokenVault({
            seed,
            dir: "secret",
            storage: {
                save: (name, content) => plugin.saveData(name, content),
                load: async (name) => {
                    const data = await plugin.loadData(name);
                    // 思源 loadData 无文件时返回空串，归一为 null
                    return typeof data === "string" && data.trim() ? data : null;
                },
                remove: (name) => plugin.removeData(name),
            },
        });
    }
    return tokenVault;
}

export function getGitHubToken(): string {
    return tokenVault?.cachedToken ?? "";
}

/** 插件关闭时清空内存中的 Token（磁盘密文保留，下次加载自动恢复） */
export function clearRuntimeSecretCache(): void {
    tokenVault?.clear();
}

/**
 * 构建插件设置面板；由入口 `this.setting = createSetting(this)` 挂载
 */
export function createSetting(plugin: Plugin): Setting {
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
    if (!tokenInputWrapper || !tokenInput || !togglePasswordIcon) {
        throw new Error("Failed to create token input elements");
    }
    togglePasswordIcon.addEventListener("click", () => {
        tokenInput.type = tokenInput.type === "password" ? "text" : "password";
    });

    const setting = new Setting({
        confirmCallback: async () => {
            const token = tokenInput.value.trim();
            const vault = getTokenVault(plugin);
            // 删除 Token
            if (!token) {
                try {
                    await vault.removeToken();
                } catch {
                    message(i18n.githubTokenRemoveFailed);
                    return;
                }
                return;
            }

            // 加密 Token 保存到磁盘（加密与落盘任一失败统一提示）
            try {
                await vault.saveToken(token);
            } catch {
                message(i18n.githubTokenSaveFailed);
                return;
            }
        },
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
            tokenInput.value = getGitHubToken();
            return tokenInputWrapper;
        },
    });

    return setting;
}

/** 从磁盘恢复已保存的设置到运行时 */
export async function loadSetting(plugin: Plugin): Promise<void> {
    const vault = getTokenVault(plugin);
    try {
        // 磁盘上无密文（首次启用或换了设备/工作空间）时静默，不视为解密失败
        if (!(await vault.hasStoredToken())) {
            vault.clear();
            return;
        }
        // 解密 Token
        const token = await vault.loadToken();
        if (token === null) {
            message(i18n.githubTokenDecryptFailed);
            return;
        }
    } catch {
        /* 首次启用或无历史数据时忽略 */
    }
}
