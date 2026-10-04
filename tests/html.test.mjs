/**
 * `infra/html.ts` 的单元测试
 *
 * GitHub 接口与集市包元数据里的文案、地址都会经过这两个函数进入页面，
 * 因此把「哪些字符被转义」「哪些地址被放行」固定下来
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { escapeHtml, safeExternalUrl } from "../src/infra/html.ts";

test("escapeHtml 转义会破坏 HTML 结构的字符", () => {
    assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    assert.equal(escapeHtml("a & b"), "a &amp; b");
    // 单引号不转义：模板里的属性值一律用双引号
    assert.equal(escapeHtml("it's"), "it's");
});

test("safeExternalUrl 只放行 http / https", () => {
    assert.equal(safeExternalUrl("https://github.com/TCOTC/install-package"), "https://github.com/TCOTC/install-package");
    assert.equal(safeExternalUrl("http://example.com/"), "http://example.com/");
    // 大小写与默认端口由 URL 归一化
    assert.equal(safeExternalUrl("HTTPS://GitHub.com:443/a"), "https://github.com/a");
});

test("safeExternalUrl 拒绝其它协议与不完整地址", () => {
    assert.equal(safeExternalUrl("javascript:alert(1)"), "");
    assert.equal(safeExternalUrl("data:text/html,<script>alert(1)</script>"), "");
    assert.equal(safeExternalUrl("file:///C:/Windows"), "");
    // 无协议的短写不补全，避免把用户输入当成可信地址
    assert.equal(safeExternalUrl("github.com/a/b"), "");
    assert.equal(safeExternalUrl("  "), "");
});
