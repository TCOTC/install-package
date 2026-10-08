/**
 * `install/packageChange.ts` 的单元测试
 *
 * 该模块只解析内核推送的载荷，没有运行期依赖，可以直接在 Node 下 import。
 * 重点是把「哪些通知算集市包变更」「类型怎么取」「包名怎么取」固定下来：
 * `reloadPlugin` 里的 `unloadPlugins` 是**禁用**，混成卸载会让界面把还在的包收起来
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePackageChange } from "../src/install/packageChange.ts";

test("bazaarChanged 带出受影响的类型，按内核顺序排列并去重", () => {
    assert.deepEqual(parsePackageChange({ cmd: "bazaarChanged", code: 0, msg: "", data: ["themes"] }), {
        types: ["themes"],
        removedPlugins: [],
    });
    assert.deepEqual(parsePackageChange({ cmd: "bazaarChanged", data: ["themes", "plugins", "themes"] }), {
        types: ["plugins", "themes"],
        removedPlugins: [],
    });
});

test("bazaarChanged 载荷缺失或类型全非法时按「类型未指明」处理", () => {
    const unspecified = { types: [], removedPlugins: [] };
    assert.deepEqual(parsePackageChange({ cmd: "bazaarChanged", code: 0, msg: "" }), unspecified);
    assert.deepEqual(parsePackageChange({ cmd: "bazaarChanged", data: "plugins" }), unspecified);
    assert.deepEqual(parsePackageChange({ cmd: "bazaarChanged", data: ["nope", 1, null] }), unspecified);
});

test("reloadPlugin 的 uninstallPlugins 是卸载，带出包名并限定插件类型", () => {
    const detail = {
        cmd: "reloadPlugin",
        code: 0,
        msg: "",
        data: { uninstallPlugins: ["a"], unloadPlugins: [], reloadPlugins: [], dataChangePlugins: [] },
    };
    assert.deepEqual(parsePackageChange(detail), { types: ["plugins"], removedPlugins: ["a"] });
});

test("只禁用（unloadPlugins）或只是热重载时不算变更", () => {
    const unloadOnly = {
        cmd: "reloadPlugin",
        code: 0,
        msg: "",
        data: { uninstallPlugins: [], unloadPlugins: ["a"], reloadPlugins: [] },
    };
    assert.equal(parsePackageChange(unloadOnly), null);
    assert.equal(parsePackageChange({ cmd: "reloadPlugin", data: { reloadPlugins: ["a"] } }), null);
    assert.equal(parsePackageChange({ cmd: "reloadPlugin", data: {} }), null);
});

test("包名过滤非字符串与空串，并合并重复项", () => {
    const detail = { cmd: "reloadPlugin", data: { uninstallPlugins: ["a", "a", "", 1, null, "b"] } };
    assert.deepEqual(parsePackageChange(detail), { types: ["plugins"], removedPlugins: ["a", "b"] });
});

test("其它 ws-main 通知与非对象载荷一律返回 null", () => {
    // `ws-main` 上还有 reloaddoc、setSnippet 等大量通知，逐一覆盖没有意义，抽查两条
    for (const detail of [
        undefined,
        null,
        "bazaarChanged",
        42,
        {},
        { cmd: "reloaddoc", data: "20210808180117-6v0mkxr" },
        { cmd: "setSnippet", data: {} },
        { cmd: "reloadui" },
    ]) {
        assert.equal(parsePackageChange(detail), null);
    }
});
