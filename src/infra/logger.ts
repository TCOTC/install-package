/**
 * 日志端口
 *
 * 插件里有两处日志出口：安装面板把日志行写进页面元素（`ui/logger.ts`），没有日志区的页面
 * （集市 PR 页、已安装列表）只写控制台（本模块的 `createConsoleLogger`）。两者共用这里的
 * `Logger` 形状，而内核请求封装、GitHub 接口与安装流程都只依赖该形状、不关心实现，
 * 因此把契约放在基础设施层，避免下层反向依赖 `ui/`
 */

/** 安装日志：`log.info` 为普通行，`log.warn` 为告警行 */
export type Logger = {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    /** 在日志区开一条可原地刷新的进度行；同一时刻最多一条，再次调用会复用它 */
    progress: (text: string) => InstallLogProgress;
};

/**
 * 日志区进度行句柄。
 *
 * 进度行在日志中始终保持为最后一行；`finish` 后该行定稿为普通日志行（不再原地刷新），`discard` 则整行移除
 */
export type InstallLogProgress = {
    update: (text: string) => void;
    /** 定稿为普通日志行；`warn` 为 true 时改用告警样式，用于以失败收尾的进度行 */
    finish: (text: string, options?: { warn?: boolean }) => void;
    discard: () => void;
};

/**
 * 没有日志区的页面用（如集市 PR 页）：把日志写到开发者工具的控制台，界面自行用状态行等提示
 */
export function createConsoleLogger(): Logger {
    return {
        info: (...args: unknown[]): void => console.log(...args),
        warn: (...args: unknown[]): void => console.warn(...args),
        // 该类页面不展示进度行，返回空实现以满足接口
        progress: () => ({
            update: (): void => {},
            finish: (): void => {},
            discard: (): void => {},
        }),
    };
}
