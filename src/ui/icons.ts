/**
 * 插件用到的全部图标
 *
 * 除了自备的两个（自 lucide 取用），其余本来直接引用思源的内置图标（`#iconSettings` 等）。
 * 为避免思源以后调整图标时插件的观感跟着变，这里把用到的内置图标按当前形态复制一份，
 * 并用插件自己的 id 注册（统一 `iconInstallPackage` 前缀），运行时不再依赖思源的图标集合。
 *
 * 上游：思源内置图标集 `appearance/icons/litheness/icon.js`（源自 ISC 许可的 Lucide，
 * 路径数据与描边宽度均按原样保留）。改动这些图标时应同步对照上游，而不是随手改路径。
 */

/** 顶栏与「安装集市包」页签（lucide store） */
export const INSTALL_PACKAGE_ICON_ID = "iconInstallPackage";
/** 「集市 PR」页签（lucide git-pull-request） */
export const BAZAAR_PR_ICON_ID = "iconInstallPackageBazaarPr";
/** 「本地集市包」入口与页签（复制自内置 iconPlugin，lucide puzzle） */
export const LOCAL_PACKAGE_ICON_ID = "iconInstallPackagePlugin";
/** 入口菜单「插件设置」（复制自内置 iconSettings，lucide settings） */
export const SETTINGS_ICON_ID = "iconInstallPackageSettings";
/** 卡片上的「检查更新」（复制自内置 iconRefresh，lucide refresh-cw） */
export const REFRESH_ICON_ID = "iconInstallPackageRefresh";
/** 「卸载」（复制自内置 iconTrashcan，lucide trash-2） */
export const TRASHCAN_ICON_ID = "iconInstallPackageTrashcan";
/** 日志右键菜单「复制」（复制自内置 iconCopy，lucide copy） */
export const COPY_ICON_ID = "iconInstallPackageCopy";
/** 版本菜单里的已选中标记（复制自内置 iconSelect，lucide check） */
export const SELECT_ICON_ID = "iconInstallPackageSelect";
/** 卡片图标缺失时的占位（复制自内置 iconBazaar，lucide store） */
export const BAZAAR_ICON_ID = "iconInstallPackageBazaar";
/** 设置面板里的令牌显示/隐藏（复制自内置 iconEye，lucide eye） */
export const EYE_ICON_ID = "iconInstallPackageEye";
/** 入口菜单「本地集市包列表」（复制自内置 iconMenu，lucide menu） */
export const LIST_ICON_ID = "iconInstallPackageList";
/** 主题、图标的「禁用」（复制自内置 iconClose，lucide x） */
export const CLOSE_ICON_ID = "iconInstallPackageClose";
/** 「打开本地详情页」（复制自内置 iconInfo，lucide info） */
export const INFO_ICON_ID = "iconInstallPackageInfo";
/** 安装页「历史安装记录」（复制自内置 iconHistory，lucide history） */
export const HISTORY_ICON_ID = "iconInstallPackageHistory";

/**
 * 图标定义
 *
 * 复制自思源的图标只保留其 `<symbol>`，属性（viewBox、fill、stroke、描边宽度、圆角端点）照抄，
 * 因此在本插件里渲染出来的效果与思源内置图标完全一致
 */
export const INSTALL_PACKAGE_ICON_SYMBOLS = `
<symbol id="${INSTALL_PACKAGE_ICON_ID}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7">
        <path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5m8.774-10.69a1.12 1.12 0 0 0-1.549 0a2.5 2.5 0 0 1-3.451 0a1.12 1.12 0 0 0-1.548 0a2.5 2.5 0 0 1-3.452 0a1.12 1.12 0 0 0-1.549 0a2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/>
        <path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/>
    </g>
</symbol>
<symbol id="${BAZAAR_PR_ICON_ID}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7">
        <circle cx="18" cy="18" r="3"/>
        <circle cx="6" cy="6" r="3"/>
        <path d="M13 6h3a2 2 0 0 1 2 2v7"/>
        <path d="M6 9v12"/>
    </g>
</symbol>
<symbol id="${LOCAL_PACKAGE_ICON_ID}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/>
</symbol>
<symbol id="${SETTINGS_ICON_ID}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>
</symbol>
<symbol id="${REFRESH_ICON_ID}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>
</symbol>
<symbol id="${TRASHCAN_ICON_ID}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
</symbol>
<symbol id="${COPY_ICON_ID}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><path d="M16 4h2a2 2 0 0 1 2 2v4"/><path d="M21 14H11"/><path d="m15 10-4 4 4 4"/>
</symbol>
<symbol id="${SELECT_ICON_ID}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 6 9 17l-5-5"/>
</symbol>
<symbol id="${BAZAAR_ICON_ID}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/><path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/>
</symbol>
<symbol id="${EYE_ICON_ID}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>
</symbol>
<symbol id="${LIST_ICON_ID}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/>
</symbol>
<symbol id="${CLOSE_ICON_ID}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
</symbol>
<symbol id="${INFO_ICON_ID}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
</symbol>
<symbol id="${HISTORY_ICON_ID}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>
</symbol>
`;
