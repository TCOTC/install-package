/**
 * `ui/panelData.ts` 的单元测试
 *
 * 该模块只依赖类型，可以直接在 Node 下 import。重点覆盖「入口投递的安装目标」：
 * 它早期放在模块级变量里，页签没建成时会留给下一个页签，因此改为随页签数据投递，
 * 这里把取出即删除、形态校验、重复取出为空这几个行为固定下来
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
    normalizeData,
    parseInstalled,
    parsePull,
    PENDING_INSTALL_PRESET_KEY,
    resolveVersionPin,
    serializeInstalled,
    serializePull,
    takePendingInstallPreset,
} from "../src/ui/panelData.ts";

test("normalizeData 只保留已知字段并修剪字符串", () => {
    const data = normalizeData({
        url: "  https://github.com/a/b  ",
        version: "v1.0.0",
        enableAfterInstall: false,
        presetRepoKey: "a/b",
        presetPull: "{}",
        presetInstalled: "",
        unknownKey: "should be dropped",
    });
    assert.deepEqual(data, {
        url: "https://github.com/a/b",
        version: "v1.0.0",
        enableAfterInstall: false,
        repoKey: "",
        presetRepoKey: "a/b",
        presetPull: "{}",
        presetInstalled: "",
    });
    assert.equal("unknownKey" in data, false);
});

test("normalizeData 对非对象与错误类型取缺省值", () => {
    assert.deepEqual(normalizeData(null), normalizeData(undefined));
    const data = normalizeData({ url: 42, enableAfterInstall: "yes", presetRepoKey: null });
    assert.equal(data.url, "");
    assert.equal(data.enableAfterInstall, true);
    assert.equal(data.presetRepoKey, "");
});

test("来源 PR / 本地包信息的序列化与反序列化对称", () => {
    const pull = { number: 12, title: "Add a/b", htmlUrl: "https://x/1", labels: [{ name: "ci-passed", color: "1a7f37" }] };
    assert.deepEqual(parsePull(serializePull(pull)), pull);
    assert.equal(serializePull(undefined), "");
    assert.equal(parsePull(""), undefined);
    // 内容异常时按「无信息」处理，只影响展示
    assert.equal(parsePull("not json"), undefined);
    assert.equal(parsePull('{"number":"12"}'), undefined);

    const installed = {
        kernelType: "plugins",
        name: "install-package",
        displayName: "安装集市包",
        version: "0.4.6",
        enableAfterInstall: true,
    };
    assert.deepEqual(parseInstalled(serializeInstalled(installed)), installed);
    assert.equal(serializeInstalled(undefined), "");
    assert.equal(parseInstalled(""), undefined);
    assert.equal(parseInstalled('{"name":"x"}'), undefined);
});

test("投递的安装目标取出后即从页签数据删除", () => {
    const preset = { url: "https://github.com/a/b", repoKey: "a/b" };
    const raw = { [PENDING_INSTALL_PRESET_KEY]: preset, url: "" };
    assert.deepEqual(takePendingInstallPreset(raw), preset);
    assert.equal(PENDING_INSTALL_PRESET_KEY in raw, false);
    // 再取一次为空：不会把同一个目标递给下一个页签
    assert.equal(takePendingInstallPreset(raw), null);
});

test("resolveVersionPin：入口带入的目标始终保留版本", () => {
    // 本地集市包形态：URL 与版本栏被隐藏，清了无法恢复
    assert.deepEqual(resolveVersionPin("a/b", "a/b", null), { keep: true, historyPickRepoKey: null });
    // 与入口目标无关的仓库照常清空
    assert.deepEqual(resolveVersionPin("c/d", "a/b", null), { keep: false, historyPickRepoKey: null });
});

test("resolveVersionPin：历史记录选定的版本命中后消费标记", () => {
    // 命中：保留版本，标记置空（用户随后再改 URL 时会照常清空）
    assert.deepEqual(resolveVersionPin("a/b", "", "a/b"), { keep: true, historyPickRepoKey: null });
    // 未命中：标记留着（用户可能还在改 URL），版本照常清空
    assert.deepEqual(resolveVersionPin("c/d", "", "a/b"), { keep: false, historyPickRepoKey: "a/b" });
    // 解析失败（空仓库键）同样视为未命中
    assert.deepEqual(resolveVersionPin("", "", "a/b"), { keep: false, historyPickRepoKey: "a/b" });
    // 入口目标与历史记录同时存在时，标记不会被消费
    assert.deepEqual(resolveVersionPin("a/b", "a/b", "x/y"), { keep: true, historyPickRepoKey: "x/y" });
});

test("投递的安装目标带上来源信息", () => {
    const raw = {
        [PENDING_INSTALL_PRESET_KEY]: {
            url: "https://github.com/a/b",
            repoKey: "a/b",
            installed: { kernelType: "themes", name: "t", displayName: "T", version: "1.0.0" },
        },
    };
    const preset = takePendingInstallPreset(raw);
    assert.equal(preset.repoKey, "a/b");
    assert.equal(preset.installed.name, "t");
});

test("投递的安装目标形态不符时按无目标处理，并清掉该键", () => {
    assert.equal(takePendingInstallPreset({}), null);
    assert.equal(takePendingInstallPreset({ [PENDING_INSTALL_PRESET_KEY]: null }), null);
    assert.equal(takePendingInstallPreset({ [PENDING_INSTALL_PRESET_KEY]: "a/b" }), null);
    const missingRepoKey = { [PENDING_INSTALL_PRESET_KEY]: { url: "https://github.com/a/b" } };
    assert.equal(takePendingInstallPreset(missingRepoKey), null);
    assert.equal(PENDING_INSTALL_PRESET_KEY in missingRepoKey, false);
});
