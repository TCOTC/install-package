/**
 * 安装面板的数据模型
 *
 * 两块数据都在面板之外被使用，因此单独成模块：
 * - `InstallPanelData`：持久化在页签 `layout.customModelData` 里的表单，面板、仓库解析与版本控件共用
 * - `InstallPanelPreset`：由别的页签（集市 PR 页、本地集市包页）带入的安装目标，入口与面板共用
 *
 * 放在这里而不是 `panel.ts`，是为了让 `repoParser`、`version` 等子模块只依赖数据模型，
 * 不再反向依赖面板本身
 */

import type { BazaarPullLabel } from "../github/bazaarPrs";

/** 持久化在自定义页签 layout.customModelData 中的表单（与 Custom.data 为同一引用） */
export interface InstallPanelData {
    url: string;
    version: string;
    enableAfterInstall: boolean;
    /** 最近一次成功解析的仓库键，形如 "owner/repo"；空字符串表示当前无有效仓库 */
    repoKey: string;
    /** 入口带入目标的包仓库键（小写 owner/repo）；空串表示这是顶栏入口的完整表单 */
    presetRepoKey: string;
    /** 入口带入的来源 PR 信息（JSON）；供页签重载后恢复展示 */
    presetPull: string;
    /** 入口带入的来源本地集市包信息（JSON）；供页签重载后恢复「隐藏 URL、保留版本」形态 */
    presetInstalled: string;
}

const INSTALL_PANEL_DEFAULT: InstallPanelData = {
    url: "",
    version: "",
    enableAfterInstall: true,
    repoKey: "",
    presetRepoKey: "",
    presetPull: "",
    presetInstalled: "",
};

const INSTALL_PANEL_KEYS = Object.keys(INSTALL_PANEL_DEFAULT) as (keyof InstallPanelData)[];

/** 从 layout 读出的 `custom.data` 生成标准表单对象（新对象；由调用方赋回 `custom.data`） */
export function normalizeData(raw: unknown): InstallPanelData {
    const data: Record<keyof InstallPanelData, string | boolean> = { ...INSTALL_PANEL_DEFAULT };
    if (raw && typeof raw === "object") {
        const record = raw as Record<string, unknown>;
        for (const key of INSTALL_PANEL_KEYS) {
            const value = record[key];
            const def = INSTALL_PANEL_DEFAULT[key];
            if (typeof def === "string") {
                data[key] = typeof value === "string" ? value.trim() : def;
            } else if (typeof def === "boolean") {
                data[key] = typeof value === "boolean" ? value : def;
            }
        }
    }
    return data as InstallPanelData;
}

/** 来源 PR 的展示信息（由集市 PR 页带入） */
export interface InstallPanelPull {
    number: number;
    title: string;
    htmlUrl: string;
    labels: BazaarPullLabel[];
}

/** 来源本地集市包的展示信息（由「本地集市包」页带入） */
export interface InstallPanelInstalledSource {
    /** 内核包类型（复数），用于展示 */
    kernelType: string;
    /** 包名（安装目录名） */
    name: string;
    /** 当前语言下的展示名 */
    displayName: string;
    /** 已安装版本，回填到版本栏 */
    version: string;
    /** 该包当前的启用状态，用作「安装后启用」的初始值；挂件与模板没有该状态时省略 */
    enableAfterInstall?: boolean;
}

/**
 * 由别的页签（集市 PR 页、本地集市包页）带过来的安装目标
 *
 * URL 与版本已确定，面板形态由来源决定：PR 来源隐藏 URL 与版本栏并展示 PR，
 * 本地集市包来源只隐藏 URL 栏（保留版本下拉框），并回填已安装版本
 */
export interface InstallPanelPreset {
    url: string;
    /** 目标包仓库键（`owner/repo`）；面板内统一按小写存储与比较 */
    repoKey: string;
    pull?: InstallPanelPull;
    installed?: InstallPanelInstalledSource;
}

/** 来源 PR 信息的序列化；无信息时为空串 */
export function serializePull(pull: InstallPanelPull | undefined): string {
    return pull === undefined ? "" : JSON.stringify(pull);
}

/** 反序列化来源 PR 信息；内容异常时按「无信息」处理，只影响展示 */
export function parsePull(raw: string): InstallPanelPull | undefined {
    if (raw === "") {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return undefined;
    }
    const pull = parsed as Partial<InstallPanelPull> | null;
    if (!pull || typeof pull.number !== "number" || typeof pull.title !== "string") {
        return undefined;
    }
    return {
        number: pull.number,
        title: pull.title,
        htmlUrl: typeof pull.htmlUrl === "string" ? pull.htmlUrl : "",
        labels: Array.isArray(pull.labels) ? pull.labels : [],
    };
}

/** 来源本地集市包信息的序列化；无信息时为空串 */
export function serializeInstalled(installed: InstallPanelInstalledSource | undefined): string {
    return installed === undefined ? "" : JSON.stringify(installed);
}

/**
 * 入口把安装目标投递给新页签时用的键
 *
 * 目标写在页签自己的 `Custom.data` 里而不是模块级变量：页签没建成时目标不会留给下一个页签，
 * 也不会出现两个页签抢同一份待载入目标
 */
export const PENDING_INSTALL_PRESET_KEY = "__pendingInstallPreset";

/**
 * 从页签数据里取出入口投递的安装目标，并删除该键（不留在页签数据里反复持久化）
 *
 * 投递方是插件自身（集市 PR 页、本地集市包页），因此只做最小形态校验；形态不符时按无目标处理
 */
export function takePendingInstallPreset(data: Record<string, unknown>): InstallPanelPreset | null {
    const raw: unknown = data[PENDING_INSTALL_PRESET_KEY];
    delete data[PENDING_INSTALL_PRESET_KEY];
    if (raw === null || typeof raw !== "object") {
        return null;
    }
    const preset = raw as Partial<InstallPanelPreset>;
    if (typeof preset.url !== "string" || typeof preset.repoKey !== "string") {
        return null;
    }
    return {
        url: preset.url,
        repoKey: preset.repoKey,
        ...(preset.pull === undefined ? {} : { pull: preset.pull }),
        ...(preset.installed === undefined ? {} : { installed: preset.installed }),
    };
}

/** 反序列化来源本地集市包信息；内容异常时按「无信息」处理，只影响展示与回填 */
export function parseInstalled(raw: string): InstallPanelInstalledSource | undefined {
    if (raw === "") {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return undefined;
    }
    const installed = parsed as Partial<InstallPanelInstalledSource> | null;
    if (!installed || typeof installed.name !== "string" || typeof installed.kernelType !== "string") {
        return undefined;
    }
    return {
        kernelType: installed.kernelType,
        name: installed.name,
        displayName: typeof installed.displayName === "string" && installed.displayName !== "" ? installed.displayName : installed.name,
        version: typeof installed.version === "string" ? installed.version : "",
        // 与 serializeInstalled 对称：该字段可省略，但该带上时必须带上
        ...(typeof installed.enableAfterInstall === "boolean" ? { enableAfterInstall: installed.enableAfterInstall } : {}),
    };
}
