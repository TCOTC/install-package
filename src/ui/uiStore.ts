/**
 * 安装面板 UI 切片：`reduceInstallPanelSlice` 负责纯状态迁移，`InstallPanelUiStore` 持有当前切片并转发 dispatch。
 * 安装区三态由 `resolveInstallButtonState` 统一推导；`InstallPanelUiStore.syncInstallButtonState` 负责 `getOwnerRepo` 异步与序号作废，面板只传入回调并写 DOM。
 */

import { isRepoInstalling, isSameTargetInstalling } from "../install/installSession";

export interface InstallPanelSliceState {
    /**
     * 仓库输入解析阶段：`parsing` 进行中，`invalid` 无效或未就绪，`ready` 可安装
     */
    parsePhase: "parsing" | "invalid" | "ready";
    /**
     * 最近一次 `parse/settled` 的 `owner/repo`；空字符串表示当前输入无效
     */
    settledOwnerRepo: { owner: string; repo: string } | null;
    /**
     * 上次 `parse/settled` 的仓库键：空字符串表示无有效仓库，非空表示 `owner/repo`
     */
    lastParsedRepoKey: string;
    /**
     * 本面板当前进行中的安装目标；`install/started` 写入，`install/ended` 清空
     */
    activeOwnerRepo: { owner: string; repo: string } | null;
}

export type InstallPanelAction =
    | { type: "parse/parsing" }
    | { type: "parse/settled"; ownerRepo: { owner: string; repo: string } | null }
    | { type: "install/started"; ownerRepo: { owner: string; repo: string } }
    | { type: "install/ended" };

export type InstallPanelReducerOut =
    | { kind: "state"; state: InstallPanelSliceState }
    | { kind: "parseSettled"; state: InstallPanelSliceState; clearVersion: boolean };

/**
 * 纯 reducer：不执行副作用。`parse/settled` 时是否清空版本由调用方根据 `clearVersion` 处理。
 * 每次 settled 都把 `lastParsedRepoKey` 写成当前键；当本次键与上次不同（含空字符串 ↔ 有效仓库）时清空版本。
 */
export function reduceInstallPanelSlice(
    state: InstallPanelSliceState,
    action: Extract<InstallPanelAction, { type: "parse/settled" }>,
): Extract<InstallPanelReducerOut, { kind: "parseSettled" }>;
export function reduceInstallPanelSlice(
    state: InstallPanelSliceState,
    action: InstallPanelAction,
): InstallPanelReducerOut;
export function reduceInstallPanelSlice(
    state: InstallPanelSliceState,
    action: InstallPanelAction,
): InstallPanelReducerOut {
    switch (action.type) {
        case "parse/parsing":
            return {
                kind: "state",
                state: { ...state, parsePhase: "parsing" },
            };
        case "parse/settled": {
            const ownerRepo = action.ownerRepo;
            const prevKey = state.lastParsedRepoKey;
            const newKey = ownerRepo ? `${ownerRepo.owner}/${ownerRepo.repo}` : "";
            const installReady = ownerRepo !== null;
            const clearVersion = prevKey !== newKey;
            const next: InstallPanelSliceState = {
                ...state,
                parsePhase: installReady ? "ready" : "invalid",
                settledOwnerRepo: ownerRepo,
                lastParsedRepoKey: newKey,
            };
            return {
                kind: "parseSettled",
                state: next,
                clearVersion,
            };
        }
        case "install/started":
            return {
                kind: "state",
                state: { ...state, activeOwnerRepo: { ...action.ownerRepo } },
            };
        case "install/ended":
            return { kind: "state", state: { ...state, activeOwnerRepo: null } };
        default:
            return { kind: "state", state };
    }
}

export class InstallPanelUiStore {
    private state: InstallPanelSliceState;

    constructor(initialLastParsedRepoKey: string) {
        this.state = {
            parsePhase: "invalid",
            settledOwnerRepo: null,
            lastParsedRepoKey: initialLastParsedRepoKey,
            activeOwnerRepo: null,
        };
    }

    /** 作废过期的 `getOwnerRepo` 异步回调，与 `resolveInstallButtonState` 搭配使用 */
    private installButtonSyncSeq = 0;

    getState(): Readonly<InstallPanelSliceState> {
        return this.state;
    }

    dispatch(action: Extract<InstallPanelAction, { type: "parse/settled" }>): Extract<
        InstallPanelReducerOut,
        { kind: "parseSettled" }
    >;
    dispatch(action: InstallPanelAction): InstallPanelReducerOut;
    dispatch(action: InstallPanelAction): InstallPanelReducerOut {
        const out = reduceInstallPanelSlice(this.state, action);
        this.state = out.state;
        return out;
    }

    /**
     * 按 `resolveInstallButtonState` 更新安装区：能同步则立即 `apply`，否则 `await resolveOwnerRepo()` 后再算（序号对齐防竞态）。
     * `getSelectedVersion` 用回调而非快照：异步返回后会再取一次，避免用户在等待 `getOwnerRepo` 期间改版本仍用旧值。
     */
    syncInstallButtonState(options: {
        getSelectedVersion: () => string;
        resolveOwnerRepo: () => Promise<{ owner: string; repo: string } | null>;
        apply: (state: InstallButtonState) => void;
    }): void {
        const version = options.getSelectedVersion();
        const first = resolveInstallButtonState(this.getState(), undefined, version);
        if (first.kind === "final") {
            this.installButtonSyncSeq++;
            options.apply(first.state);
            return;
        }
        const seq = ++this.installButtonSyncSeq;
        void (async (): Promise<void> => {
            const ownerRepo = await options.resolveOwnerRepo();
            if (seq !== this.installButtonSyncSeq) {
                return;
            }
            const second = resolveInstallButtonState(
                this.getState(),
                ownerRepo,
                options.getSelectedVersion(),
            );
            if (second.kind !== "final") {
                return;
            }
            options.apply(second.state);
        })();
    }
}

/**
 * 安装区 UI 三态（不含具体 DOM 操作）：
 * - `cannotInstall`：无法安装（解析未就绪、缺版本、或与全局占用冲突等）
 * - `canInstall`：可以安装
 * - `installing`：正在安装（中止可见、安装按钮区域按面板样式隐藏）
 */
export type InstallButtonState = "cannotInstall" | "canInstall" | "installing";

export type ResolveInstallButtonStateResult =
    | { kind: "final"; state: InstallButtonState }
    | { kind: "awaitOwnerRepo" };

/**
 * 统一推导安装区三态。
 * - `resolvedOwnerRepo === undefined`：尚未与当前 URL 对齐（需先 `await getOwnerRepo()`），且仅当解析已就绪、且非本面板安装中时返回 `awaitOwnerRepo`。
 * - `resolvedOwnerRepo === null`：已对齐但无效；`object`：已对齐且有效。
 */
export function resolveInstallButtonState(
    slice: InstallPanelSliceState,
    resolvedOwnerRepo: { owner: string; repo: string } | null | undefined,
    selectedVersion: string,
): ResolveInstallButtonStateResult {
    const ownerRepo = slice.activeOwnerRepo;
    if (ownerRepo !== null && isRepoInstalling(ownerRepo.owner, ownerRepo.repo)) {
        return { kind: "final", state: "installing" };
    }
    if (!isRepoParseReadyForInstall(slice)) {
        return { kind: "final", state: "cannotInstall" };
    }
    if (resolvedOwnerRepo === undefined) {
        return { kind: "awaitOwnerRepo" };
    }
    const ok =
        resolvedOwnerRepo !== null &&
        Boolean(selectedVersion) &&
        !isSameTargetInstalling(resolvedOwnerRepo.owner, resolvedOwnerRepo.repo, selectedVersion);
    return { kind: "final", state: ok ? "canInstall" : "cannotInstall" };
}

export function isRepoParseReadyForInstall(slice: InstallPanelSliceState): boolean {
    return slice.parsePhase === "ready" && slice.settledOwnerRepo !== null;
}
