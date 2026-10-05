/**
 * `install/packageVersion.ts` 的单元测试
 *
 * 版本比较决定「已安装版本是否为最新」与「能否自我安装」两个结论，写错会把有新版本说成已是最新（或反之），
 * 因此把语义化版本 2.0.0 的解析与比较边界固定下来
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { comparePackageVersions, isVersionAtLeast } from "../src/install/packageVersion.ts";

test("归一化 v 前缀", () => {
    assert.equal(comparePackageVersions("v0.4.6", "0.4.6"), 0);
    assert.equal(comparePackageVersions("V1.2.3", "1.2.3"), 0);
});

test("核心三段缺一不可", () => {
    // 语义化版本要求 主.次.修订 齐全，`1` 与 `1.2` 都不合法
    assert.equal(comparePackageVersions("1", "1.0.0"), null);
    assert.equal(comparePackageVersions("1.2", "1.2.0"), null);
    assert.equal(comparePackageVersions("v1.2", "1.2.0"), null);
});

test("数字标识符不允许前导零", () => {
    assert.equal(comparePackageVersions("01.0.0", "1.0.0"), null);
    assert.equal(comparePackageVersions("1.00.0", "1.0.0"), null);
    assert.equal(comparePackageVersions("1.0.0-01", "1.0.0-1"), null);
});

test("比较三段数字版本", () => {
    assert.equal(comparePackageVersions("0.5.0", "0.4.6"), 1);
    assert.equal(comparePackageVersions("0.4.6", "0.5.0"), -1);
    assert.equal(comparePackageVersions("1.0.0", "0.99.99"), 1);
});

test("预发布版本低于同号正式版", () => {
    assert.equal(comparePackageVersions("1.0.0-beta", "1.0.0"), -1);
    assert.equal(comparePackageVersions("1.0.0", "1.0.0-beta"), 1);
    assert.equal(comparePackageVersions("1.0.0-beta.1", "1.0.0-beta"), 1);
    // 数字标识符低于字母标识符
    assert.equal(comparePackageVersions("1.0.0-1", "1.0.0-alpha"), -1);
});

test("构建元数据不参与比较", () => {
    assert.equal(comparePackageVersions("1.0.0+build.1", "1.0.0+build.2"), 0);
});

test("无法解析的版本返回 null", () => {
    assert.equal(comparePackageVersions("latest", "1.0.0"), null);
    assert.equal(comparePackageVersions("1.0.0", ""), null);
    assert.equal(comparePackageVersions("1.0.0.1", "1.0.0"), null);
});

test("按语义化版本规范接受与拒绝的形态", () => {
    // 规范里的合法示例：预发布标识符可含点分数字、连字符，构建元数据不参与比较
    assert.equal(comparePackageVersions("1.0.0-0.3.7", "1.0.0-0.3.7"), 0);
    assert.equal(comparePackageVersions("1.0.0-x.7.z.92", "1.0.0-x.7.z.92"), 0);
    assert.equal(comparePackageVersions("1.0.0-x-y-z.--", "1.0.0-x-y-z.--"), 0);
    assert.equal(comparePackageVersions("1.0.0-alpha+001", "1.0.0-alpha"), 0);
    for (const invalid of ["1", "1.2", "alpha", "1.2.3.DEV", "1.2-SNAPSHOT", "1.0.0-", "1.1.2+.123", "+justmeta"]) {
        assert.equal(comparePackageVersions(invalid, "1.0.0"), null, `${invalid} 应按非法版本处理`);
    }
});

test("isVersionAtLeast：达到最低版本才算通过", () => {
    assert.equal(isVersionAtLeast("1.0.0", "1.0.0"), true);
    assert.equal(isVersionAtLeast("v1.0.1", "1.0.0"), true);
    assert.equal(isVersionAtLeast("0.9.9", "1.0.0"), false);
    // 预发布版本低于同号正式版
    assert.equal(isVersionAtLeast("1.0.0-beta", "1.0.0"), false);
    // 不合语义化版本、或解析不出来的版本一律不通过
    assert.equal(isVersionAtLeast("1.0", "1.0.0"), false);
    assert.equal(isVersionAtLeast("nightly", "1.0.0"), false);
});
