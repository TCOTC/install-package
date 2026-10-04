/**
 * 打开思源集市里某个已安装包的本地详情页
 *
 * 走 `siyuan://bazaar/<内核类型>/<包名>/readme-installed`：思源重写了 `window.open`，
 * 在内置窗口里直接交给 `processSiYuanUri` 处理（不会另起进程）；浏览器里则拉起桌面客户端。
 * 本地集市包列表菜单与安装面板共用这一份实现，避免两处链接格式走偏
 */
export function openPackageDetailPage(pkg: { kernelType: string; name: string }): void {
    window.open(`siyuan://bazaar/${pkg.kernelType}/${encodeURIComponent(pkg.name)}/readme-installed`);
}
