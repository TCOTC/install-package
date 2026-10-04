/**
 * `infra/repoKey.ts` 的单元测试
 *
 * 测试直接 import 源码 TS：Node 24 起默认开启类型剥离，因此不需要额外的构建步骤或测试依赖
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeRepoKey, repoKeyFromOwnerRepo, repoKeyOf } from "../src/infra/repoKey.ts";

test("repoKeyOf 归一化仓库地址", () => {
    assert.equal(repoKeyOf("https://github.com/TCOTC/install-package"), "tcotc/install-package");
    assert.equal(repoKeyOf("https://github.com/TCOTC/install-package.git"), "tcotc/install-package");
    assert.equal(repoKeyOf("https://github.com/TCOTC/install-package/"), "tcotc/install-package");
    assert.equal(repoKeyOf("https://github.com/TCOTC/install-package?tab=readme"), "tcotc/install-package");
    assert.equal(repoKeyOf("https://github.com/TCOTC//install-package/"), "tcotc/install-package");
});

test("repoKeyOf 对不可用的地址返回 null", () => {
    // 只有 owner：实测有包的元数据 url 就是这样
    assert.equal(repoKeyOf("https://github.com/TCOTC"), null);
    assert.equal(repoKeyOf("https://gitee.com/TCOTC/install-package"), null);
    assert.equal(repoKeyOf("not a url"), null);
    assert.equal(repoKeyOf(""), null);
});

test("repoKeyFromOwnerRepo 与 normalizeRepoKey 统一小写并去空白", () => {
    assert.equal(repoKeyFromOwnerRepo("TCOTC", "Install-Package"), "tcotc/install-package");
    assert.equal(normalizeRepoKey("  TCOTC/Install-Package  "), "tcotc/install-package");
});
