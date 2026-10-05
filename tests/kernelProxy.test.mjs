/**
 * `infra/kernelProxy.ts` 的单元测试
 *
 * 两个参数的编码必须与内核 `parseForwardProxyParams` 的 `base64.RawURLEncoding` 完全一致：
 * 用错字母表或带上 `=` 填充会让内核直接报「decode [u] failed」，表现为下载在浏览器里整体不可用
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { base64UrlNoPadding, kernelProxyUrl } from "../src/infra/kernelProxy.ts";

test("base64UrlNoPadding 用 URL 安全字母表且不带填充", () => {
    // U+FFFF 的 UTF-8 字节为 EF BF BF，标准 base64 为 77+/，URL 变体应为 77-_
    assert.equal(base64UrlNoPadding("\uffff"), "77-_");
    assert.equal(base64UrlNoPadding("a"), "YQ");
    assert.equal(base64UrlNoPadding("ab"), "YWI");
    assert.equal(base64UrlNoPadding("abc"), "YWJj");
    assert.equal(base64UrlNoPadding(""), "");
    assert.ok(!base64UrlNoPadding("a".repeat(100)).includes("="));
});

test("base64UrlNoPadding 按 UTF-8 编码后再转 base64", () => {
    // 「思源」的 UTF-8 字节为 e6 80 9d e6 ba 90
    assert.equal(base64UrlNoPadding("思源"), "5oCd5rqQ");
});

test("kernelProxyUrl 省略 headers 时只有 u 参数", () => {
    assert.equal(
        kernelProxyUrl("https://api.github.com/repos/a/b/releases/assets/1"),
        "/api/network/proxy?u=aHR0cHM6Ly9hcGkuZ2l0aHViLmNvbS9yZXBvcy9hL2IvcmVsZWFzZXMvYXNzZXRzLzE",
    );
});

test("kernelProxyUrl 把请求头序列化成 h 参数", () => {
    const url = kernelProxyUrl("https://example.com/x", {Accept: ["application/octet-stream"]});
    const h = new URLSearchParams(url.slice(url.indexOf("?"))).get("h");
    assert.equal(h, base64UrlNoPadding('{"Accept":["application/octet-stream"]}'));
    // h 必须是 URL 安全字符，不能带 + / =
    assert.match(h, /^[A-Za-z0-9_-]+$/);
});
