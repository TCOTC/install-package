/** 安装日志等场景使用的日志函数类型 */
export type Logger = (...args: unknown[]) => void;

/** 持久化在自定义页签 layout.customModelData 中的表单（与 Custom.data 为同一引用） */
export interface InstallPanelData {
    url: string;
    version: string;
    enableAfterInstall: boolean;
}
