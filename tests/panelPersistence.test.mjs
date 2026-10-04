/**
 * `ui/panelPersistence.ts` 的单元测试
 *
 * 表单的防抖持久化有两个易错点：连续改动只应写一次，重复赋同一个值不应写盘。
 * 模块只用 `window.setTimeout`，在 Node 下装一个桩即可直接测（不依赖 siyuan）
 */

import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.window = globalThis.window ?? { setTimeout, clearTimeout };

const { persistFormToLayout } = await import("../src/ui/panelPersistence.ts");

/** 计数用的保存回调 */
function counter() {
    const state = { count: 0 };
    return { state, save: () => { state.count++; } };
}

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("字段变化后延迟写入一次", async () => {
    const { state, save } = counter();
    const form = persistFormToLayout({ url: "" }, save, 10);
    form.data.url = "https://github.com/a/b";
    assert.equal(state.count, 0, "写入不应同步发生");
    await tick(30);
    assert.equal(state.count, 1);
    assert.equal(form.data.url, "https://github.com/a/b", "代理应写回原对象");
});

test("连续改动只写最后一次", async () => {
    const { state, save } = counter();
    const form = persistFormToLayout({ url: "", version: "" }, save, 10);
    form.data.url = "a";
    form.data.url = "ab";
    form.data.url = "abc";
    await tick(30);
    assert.equal(state.count, 1);
    assert.equal(form.data.url, "abc");
});

test("重复赋同一个值不触发写入", async () => {
    const { state, save } = counter();
    const form = persistFormToLayout({ enableAfterInstall: true }, save, 10);
    form.data.enableAfterInstall = true;
    await tick(30);
    assert.equal(state.count, 0);
});

test("cancel 会丢弃尚未落盘的一次写入", async () => {
    const { state, save } = counter();
    const form = persistFormToLayout({ url: "" }, save, 10);
    form.data.url = "x";
    form.cancel();
    await tick(30);
    assert.equal(state.count, 0);
});

test("flush 立即落盘", async () => {
    const { state, save } = counter();
    const form = persistFormToLayout({ version: "" }, save, 10_000);
    form.data.version = "v1.0.0";
    form.flush();
    assert.equal(state.count, 1);
    // flush 后再改再取消，不会再多写
    form.data.version = "v1.0.1";
    form.cancel();
    await tick(20);
    assert.equal(state.count, 1);
});
