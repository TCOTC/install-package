/**
 * HTML 片段与外链的安全处理
 *
 * 展示 GitHub 接口与集市包元数据里的内容时统一走这里：
 * - 拼进 HTML 字符串的文案、属性值一律先 `escapeHtml`（对 DOM 属性赋值如 `textContent`、`href` 则不必）
 * - 来自外部的链接先 `safeExternalUrl`，只放行 http/https，再决定是否渲染成可点击的链接
 */

/** 转义 HTML 特殊字符；只用于拼接 HTML 字符串，写 DOM 属性不需要 */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * 只放行 http/https 链接；其它协议（如 `javascript:`、`data:`）与非法 URL 返回空串
 *
 * 用于把外部来源的地址写进 `href` / `src` 之前：取到空串时调用方应不渲染该链接
 */
export function safeExternalUrl(url: string): string {
    const trimmed = url.trim();
    if (trimmed === "") {
        return "";
    }
    try {
        const parsed = new URL(trimmed);
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
    } catch {
        return "";
    }
}
