/**
 * `install/installedPackageList.ts` 的单元测试
 *
 * 该模块只声明用到的字段（内核类型、仓库键、包名），没有运行期依赖，可以直接在 Node 下 import，
 * 用普通对象当替身即可。重点覆盖「局部刷新的合并规则」：读失败的类型必须保持原样，
 * 否则会把还在的包当成已卸载、把它的操作键错误地收起来
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
    findInstalledByRepo,
    mergeInstalledByType,
    refreshedTypes,
    sortByKernelType,
} from "../src/install/installedPackageList.ts";

/** 测试替身：上述函数只读 kernelType / name / repoKey 三个字段 */
function pkg(kernelType, name, repoKey = "") {
    return { kernelType, name, repoKey };
}

test("findInstalledByRepo 归一查询键，包上的仓库键按解析层的输出原样比较", () => {
    // 包上的 repoKey 由解析层用 repoKeyOf 写入，已经是小写 owner/repo
    const packages = [
        pkg("plugins", "a", "owner/repo"),
        pkg("themes", "b", "owner/other"),
        pkg("icons", "c", ""),
    ];
    assert.deepEqual(findInstalledByRepo(packages, "owner/repo").map((item) => item.name), ["a"]);
    assert.deepEqual(findInstalledByRepo(packages, "  OWNER/REPO  ").map((item) => item.name), ["a"]);
    // 空键不做「返回全部」这种兜底
    assert.deepEqual(findInstalledByRepo(packages, ""), []);
    // 不在函数里再归一一次包上的键：未过解析层的数据不匹配，这是刻意的（归一只有一处）
    assert.deepEqual(findInstalledByRepo([pkg("plugins", "x", "Owner/Repo")], "owner/repo"), []);
});

test("sortByKernelType 先按内核类型顺序，再按包名", () => {
    const sorted = sortByKernelType([
        pkg("icons", "z"),
        pkg("themes", "b"),
        pkg("plugins", "p2"),
        pkg("plugins", "p1"),
        pkg("templates", "a"),
    ]);
    assert.deepEqual(sorted.map((item) => `${item.kernelType}/${item.name}`), [
        "plugins/p1",
        "plugins/p2",
        "themes/b",
        "icons/z",
        "templates/a",
    ]);
});

test("sortByKernelType 不改动入参", () => {
    const packages = [pkg("icons", "z"), pkg("plugins", "p")];
    sortByKernelType(packages);
    assert.deepEqual(packages.map((item) => item.kernelType), ["icons", "plugins"]);
});

test("refreshedTypes 排除读失败的类型", () => {
    assert.deepEqual([...refreshedTypes(["plugins", "themes"], [])], ["plugins", "themes"]);
    assert.deepEqual([...refreshedTypes(["plugins", "themes"], ["themes"])], ["plugins"]);
    assert.deepEqual([...refreshedTypes(["plugins"], ["plugins"])], []);
});

test("mergeInstalledByType 只替换刷新到的类型，其余保持原样", () => {
    const previous = [pkg("plugins", "old"), pkg("themes", "t")];
    const merged = mergeInstalledByType(previous, { packages: [pkg("plugins", "new")], failedTypes: [] }, ["plugins"]);
    assert.deepEqual(merged.map((item) => item.name), ["t", "new"]);
    // 不改动入参
    assert.deepEqual(previous.map((item) => item.name), ["old", "t"]);
});

test("mergeInstalledByType 对读失败的类型保持原样，不当成已卸载", () => {
    const previous = [pkg("plugins", "keep"), pkg("themes", "t")];
    const merged = mergeInstalledByType(
        previous,
        { packages: [], failedTypes: ["plugins"] },
        ["plugins", "themes"],
    );
    // 插件读取失败 → 旧数据保留；主题读取成功但没有包 → 换成空
    assert.deepEqual(merged.map((item) => item.name), ["keep"]);
});
