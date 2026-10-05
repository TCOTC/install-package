/**
 * `infra/frontend.ts` 的单元测试
 *
 * 面板宿主的选择完全依赖这个判定：移动端没有自定义页签，必须走对话框。
 * 判错会让整个插件在移动端点了没反应（或反之，在桌面端弹出一个多余的对话框），
 * 因此把宿主声明的五个前端取值逐个钉住
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { isMobileFrontendOf } from "../src/infra/frontend.ts";

test("移动端前端包含原生移动端与浏览器移动版", () => {
    assert.equal(isMobileFrontendOf("mobile"), true);
    assert.equal(isMobileFrontendOf("browser-mobile"), true);
});

test("桌面端前端（含分离窗口与浏览器桌面版）都不走对话框", () => {
    // 分离窗口与浏览器桌面版同样没有 Electron，但它们有完整的桌面布局与自定义页签
    assert.equal(isMobileFrontendOf("desktop"), false);
    assert.equal(isMobileFrontendOf("desktop-window"), false);
    assert.equal(isMobileFrontendOf("browser-desktop"), false);
});

test("未知取值按桌面端处理", () => {
    // 宿主新增前端时宁可走页签（桌面路径），也不要在一个未知环境里弹对话框
    assert.equal(isMobileFrontendOf(""), false);
    assert.equal(isMobileFrontendOf("future-frontend"), false);
});
