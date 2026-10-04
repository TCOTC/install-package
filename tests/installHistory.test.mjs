/**
 * `install/installHistory.ts` 的单元测试
 *
 * 该模块只依赖注入的存储适配器，可直接在 Node 下 import。存储放在插件私有目录里，
 * 解析要同时容忍「JSON 文本」（存储名无扩展名，内核按文本返回）与「已解析数组」；
 * 记录要能去重、置顶并按上限裁剪，删除/清空后还要按需删除存储文件，
 * 因此这些行为都在这里固定下来
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
    clearInstallHistory,
    ensureInstallHistoryLoaded,
    initInstallHistory,
    installHistoryUrl,
    listInstallHistory,
    mergeInstallHistoryEntry,
    parseInstallHistory,
    recordInstallHistory,
    removeInstallHistoryEntry,
} from "../src/install/installHistory.ts";

/** 把记录压成便于断言的字符串，顺带固定字段顺序 */
function compact(entries) {
    return entries.map((entry) => `${entry.owner}/${entry.repo}@${entry.tag}`);
}

const NOOP_STORAGE = { load: async () => "", save: async () => undefined, remove: async () => undefined };

test("parseInstallHistory 兼容 JSON 文本与数组，并丢弃无效条目", () => {
    assert.deepEqual(parseInstallHistory(""), []);
    assert.deepEqual(parseInstallHistory("   "), []);
    assert.deepEqual(parseInstallHistory("not json"), []);
    assert.deepEqual(parseInstallHistory(null), []);
    assert.deepEqual(parseInstallHistory({}), []);
    assert.deepEqual(parseInstallHistory([{ owner: "a", repo: "b", tag: "v1" }]), [
        { owner: "a", repo: "b", tag: "v1" },
    ]);
    const entries = parseInstallHistory(JSON.stringify([
        { owner: " a ", repo: "b", tag: "v1" },
        { owner: "a" },
        null,
        { owner: "", repo: "b", tag: "v1" },
        { owner: "c", repo: "d", tag: 1 },
    ]));
    assert.deepEqual(entries, [{ owner: "a", repo: "b", tag: "v1" }]);
});

test("parseInstallHistory 只认 tag 字段，不认识旧文件里的 version", () => {
    // 字段曾叫 version，后按「存的是 tag」改名；不保留兼容，旧条目会被当作无效丢掉
    assert.deepEqual(parseInstallHistory([{ owner: "a", repo: "b", version: "v1" }]), []);
});

test("mergeInstallHistoryEntry 去重置顶、按上限裁剪且不修改入参", () => {
    const base = [
        { owner: "o", repo: "r", tag: "v0" },
        { owner: "o", repo: "r", tag: "v1" },
        { owner: "o", repo: "r", tag: "v2" },
    ];
    const merged = mergeInstallHistoryEntry(base, { owner: "n", repo: "r", tag: "v9" }, 3);
    assert.deepEqual(compact(merged), ["n/r@v9", "o/r@v0", "o/r@v1"]);
    assert.equal(base.length, 3);

    // 同一仓库同一 tag 大小写无关，只保留一条并采用新写法
    const deduped = mergeInstallHistoryEntry(base, { owner: "O", repo: "R", tag: "V1" });
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
        remove: NOOP_STORAGE.remove,
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
        load: async () => JSON.stringify([{ owner: "a", repo: "b", tag: "v1" }]),
        save: async (entries) => {
            saved.push(compact(entries));
        },
        remove: NOOP_STORAGE.remove,
    });
    await recordInstallHistory("A", "B", "v1");
    await recordInstallHistory("c", "d", "v2");
    assert.deepEqual(compact(listInstallHistory()), ["c/d@v2", "A/B@v1"]);
    assert.deepEqual(saved, [["A/B@v1"], ["c/d@v2", "A/B@v1"]]);
});

const TWO_ENTRIES = JSON.stringify([
    { owner: "a", repo: "b", tag: "v1" },
    { owner: "c", repo: "d", tag: "v2" },
]);

/** 记录每次落盘与删文件，便于断言「什么时候才删掉配置文件」 */
function trackingStorage(raw) {
    const calls = [];
    return {
        calls,
        storage: {
            load: async () => raw,
            save: async (entries) => {
                calls.push(["save", compact(entries)]);
            },
            remove: async () => {
                calls.push(["remove"]);
            },
        },
    };
}

test("删除一条历史：大小写无关、只写盘不删文件", async () => {
    const { calls, storage } = trackingStorage(TWO_ENTRIES);
    initInstallHistory(storage);
    await removeInstallHistoryEntry("A", "B", "v1");
    assert.deepEqual(compact(listInstallHistory()), ["c/d@v2"]);
    assert.deepEqual(calls, [["save", ["c/d@v2"]]]);
});

test("删掉最后一条历史时删除配置文件", async () => {
    const { calls, storage } = trackingStorage(TWO_ENTRIES);
    initInstallHistory(storage);
    await removeInstallHistoryEntry("a", "b", "v1");
    await removeInstallHistoryEntry("c", "d", "v2");
    assert.deepEqual(compact(listInstallHistory()), []);
    assert.deepEqual(calls, [["save", ["c/d@v2"]], ["remove"]]);
});

test("清空所有历史时删除配置文件", async () => {
    const { calls, storage } = trackingStorage(TWO_ENTRIES);
    initInstallHistory(storage);
    await clearInstallHistory();
    assert.deepEqual(compact(listInstallHistory()), []);
    assert.deepEqual(calls, [["remove"]]);
});

test("记录不存在或本来为空时既不写盘也不删文件", async () => {
    const { calls, storage } = trackingStorage(TWO_ENTRIES);
    initInstallHistory(storage);
    await removeInstallHistoryEntry("x", "y", "v9");
    assert.deepEqual(compact(listInstallHistory()), ["a/b@v1", "c/d@v2"]);
    assert.deepEqual(calls, []);

    const empty = trackingStorage("");
    initInstallHistory(empty.storage);
    await clearInstallHistory();
    assert.deepEqual(empty.calls, []);
});

test("落盘失败不打断安装流程", async () => {
    initInstallHistory({
        load: NOOP_STORAGE.load,
        save: async () => {
            throw new Error("disk full");
        },
        remove: async () => {
            throw new Error("disk full");
        },
    });
    await recordInstallHistory("a", "b", "v1");
    assert.deepEqual(compact(listInstallHistory()), ["a/b@v1"]);
    // 删除失败也不外抛，内存状态照常清空
    await removeInstallHistoryEntry("a", "b", "v1");
    assert.deepEqual(compact(listInstallHistory()), []);
});

test("installHistoryUrl 由记录还原仓库 URL", () => {
    assert.equal(
        installHistoryUrl({ owner: "TCOTC", repo: "install-package", tag: "v1" }),
        "https://github.com/TCOTC/install-package",
    );
});
