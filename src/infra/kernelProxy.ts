/**
 * 内核代理（`/api/network/proxy`）的地址构造
 *
 * 浏览器端（`browser-desktop` / `browser-mobile`）与移动端 WebView 会按 CORS 拦下 GitHub Release 资源：
 * `github.com/<owner>/<repo>/releases/download/...` 的首跳 302 响应不带 `Access-Control-Allow-Origin`，
 * 浏览器直接判为请求失败（控制台报 `No 'Access-Control-Allow-Origin' header is present`）。
 * Electron 桌面窗口的 `webSecurity` 为 false（`app/electron/main.js`），所以桌面端一直没有这个问题。
 *
 * 改由同源的内核代取：`/api/network/proxy` 把上游响应体原样流回来，没有 forwardProxy 的 32 MiB 上限，
 * 客户端中止请求时内核也会通过请求上下文取消上游下载。
 *
 * 内核用 `base64.RawURLEncoding` 解 `u`（目标地址）与 `h`（转发给上游的请求头，JSON 对象、值为字符串数组），
 * 即 URL 安全、无填充的 base64。本模块保持无导入，可直接单测
 */

/** URL 安全的 base64（去填充），与内核的 `base64.RawURLEncoding` 对应 */
export function base64UrlNoPadding(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 内核代理地址
 *
 * `target` 为要访问的上游地址，`headers` 为转发给上游的请求头（可选，省略时不含 `h` 参数）
 */
export function kernelProxyUrl(target: string, headers?: Record<string, string[]>): string {
    const u = `u=${base64UrlNoPadding(target)}`;
    if (headers === undefined) {
        return `/api/network/proxy?${u}`;
    }
    return `/api/network/proxy?${u}&h=${base64UrlNoPadding(JSON.stringify(headers))}`;
}
