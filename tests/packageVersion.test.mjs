/**
 * `install/packageVersion.ts` 的单元测试
 *
 * 版本比较决定「已安装版本是否为最新」的结论，写错会把有新版本说成已是最新（或反之），
 * 因此把边界固定下来
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { comparePackageVersions } from "../src/install/packageVersion.ts";

test("归一化 v 前缀与缺省段", () => {
    assert.equal(comparePackageVersions("v0.4.6", "0.4.6"), 0);
    assert.equal(comparePackageVersions("1", "1.0.0"), 0);
    assert.equal(comparePackageVersions("1.2", "1.2.0"), 0);
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
});
