/** 安装日志：`log.info` 为普通行，`log.warn` 为告警行 */
export type Logger = {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
};

/** 持久化在自定义页签 layout.customModelData 中的表单（与 Custom.data 为同一引用） */
export interface InstallPanelData {
    url: string;
    version: string;
    enableAfterInstall: boolean;
}
