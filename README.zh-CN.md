### 概述

这是一个用于安装集市包的插件，可以下载指定 GitHub 仓库的集市包 Release 安装到思源笔记中。

### 特性

- 支持从 GitHub 仓库或集市 PR URL 下载 Release 版本
- 显示集市包信息（仓库摘要、Release 信息、文件大小）
- 文件验证和完整性检查
- 支持配置 GitHub Token（加密保存）以避免接口限流
- 支持安装插件、主题、图标、挂件、模板等集市包，并可选择安装后启用或禁用
- 安装过程在页签内输出日志，可随时中断
- 快速打开 Plugins、Petal、Themes、Icons、Widgets、Templates 等目录，或打开开发者工具和插件设置（仅桌面版）

### 使用方法

1. 点击顶部工具栏的下载图标，打开安装页签
2. 输入集市 PR URL 或 GitHub 仓库 URL（格式：`https://github.com/user/repo`、`user/repo` 或 `https://github.com/siyuan-note/bazaar/pull/xxxx`）
3. 从版本下拉菜单中选择 Git Tag（默认最新版本，支持搜索）
4. 选择安装之后是否启用集市包
5. 点击「安装集市包」开始下载；安装过程中可点击「中断安装」中止
6. 可在底部工具栏快速打开上述目录或开发者工具、插件设置（仅桌面版）

### 注意事项

- 解析和安装过程的信息会输出到页签内的「日志」区域，遇到问题可优先查看
- 遇到 GitHub 接口限流时，可在插件设置中配置 GitHub Token
