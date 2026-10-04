/**
 * `install/installHistory.ts` 的单元测试
 *
 * 该模块只依赖注入的存储适配器，可直接在 Node 下 import。存储放在插件私有目录里，
 * 解析要同时容忍「JSON 文本」（存储名无扩展名，内核按文本返回）与「已解析数组」；
 * 记录要能去重、置顶并按上限裁剪，因此这些行为都在这里固定下来
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
    ensureInstallHistoryLoaded,
    initInstallHistory,
    installHistoryUrl,
    listInstallHistory,
    mergeInstallHistoryEntry,
    parseInstallHistory,
    recordInstallHistory,
} from "../src/install/installHistory.ts";

/** 把记录压成便于断言的字符串，顺带固定字段顺序 */
function compact(entries) {
    return entries.map((entry) => `${entry.owner}/${entry.repo}@${entry.version}`);
}

const NOOP_STORAGE = { load: async () => "", save: async () => undefined };

test("parseInstallHistory 兼容 JSON 文本与数组，并丢弃无效条目", () => {
    assert.deepEqual(parseInstallHistory(""), []);
    assert.deepEqual(parseInstallHistory("   "), []);
    assert.deepEqual(parseInstallHistory("not json"), []);
    assert.deepEqual(parseInstallHistory(null), []);
    assert.deepEqual(parseInstallHistory({}), []);
    assert.deepEqual(parseInstallHistory([{ owner: "a", repo: "b", version: "v1" }]), [
        { owner: "a", repo: "b", version: "v1" },
    ]);
    const entries = parseInstallHistory(JSON.stringify([
        { owner: " a ", repo: "b", version: "v1" },
        { owner: "a" },
        null,
        { owner: "", repo: "b", version: "v1" },
        { owner: "c", repo: "d", version: 1 },
    ]));
    assert.deepEqual(entries, [{ owner: "a", repo: "b", version: "v1" }]);
});

test("mergeInstallHistoryEntry 去重置顶、按上限裁剪且不修改入参", () => {
    const base = [
        { owner: "o", repo: "r", version: "v0" },
        { owner: "o", repo: "r", version: "v1" },
        { owner: "o", repo: "r", version: "v2" },
    ];
    const merged = mergeInstallHistoryEntry(base, { owner: "n", repo: "r", version: "v9" }, 3);
    assert.deepEqual(compact(merged), ["n/r@v9", "o/r@v0", "o/r@v1"]);
    assert.equal(base.length, 3);

    // 同一仓库同一版本大小写无关，只保留一条并采用新写法
    const deduped = mergeInstallHistoryEntry(base, { owner: "O", repo: "R", version: "V1" });
    assert.deepEqual(compact(deduped), ["O/R@V1", "o/r@v0", "o/r@v2"]);
});

test("同一实例只读一次，读取失败按无记录处理", async () => {
    let loads = 0;
    initInstallHistory({
        load: async () => {
            loads += 1;
            throw new Error("boom");
        },
        save: NOOP_STORAGE.save,
    });
    await ensureInstallHistoryLoaded();
    await ensureInstallHistoryLoaded();
    assert.equal(loads, 1);
    assert.deepEqual(listInstallHistory(), []);

    // 读取失败不影响记录：仍然能并入内存并尝试落盘
    await recordInstallHistory("a", "b", "v1");
    assert.deepEqual(compact(listInstallHistory()), ["a/b@v1"]);
});

test("记录历史：并入已载入的记录、去重置顶并落盘", async () => {
    const saved = [];
    initInstallHistory({
        load: async () => JSON.stringify([{ owner: "a", repo: "b", version: "v1" }]),
        save: async (entries) => {
            saved.push(compact(entries));
        },
    });
    await recordInstallHistory("A", "B", "v1");
    await recordInstallHistory("c", "d", "v2");
    assert.deepEqual(compact(listInstallHistory()), ["c/d@v2", "A/B@v1"]);
    assert.deepEqual(saved, [["A/B@v1"], ["c/d@v2", "A/B@v1"]]);
});

test("落盘失败不打断安装流程", async () => {
    initInstallHistory({
        load: NOOP_STORAGE.load,
        save: async () => {
            throw new Error("disk full");
        },
    });
    await recordInstallHistory("a", "b", "v1");
    assert.deepEqual(compact(listInstallHistory()), ["a/b@v1"]);
});

test("installHistoryUrl 由记录还原仓库 URL", () => {
    assert.equal(
        installHistoryUrl({ owner: "TCOTC", repo: "install-package", version: "v1" }),
        "https://github.com/TCOTC/install-package",
    );
});
