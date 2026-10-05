/**
 * `install/siyuanUri.ts` 的单元测试
 *
 * 链接形态与内核 `app/src/util/uri.ts` 的解析口径一一对应：协议、主机名、第一段路径（插件包名）、
 * 动作名、`repo` 与 `tag` 参数。除「解析成功」外，重点覆盖外部链接可能的越界写法
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { INSTALL_URI_ACTION, parseInstallUri } from "../src/install/siyuanUri.ts";

const PLUGIN = "install-package";

/** 取成功的安装目标；失败时抛出并带上原因，便于定位 */
function target(uri) {
    const result = parseInstallUri(uri, PLUGIN);
    assert.equal(result.ok, true, `expected ok: ${uri} → ${result.ok ? "" : result.reason}`);
    assert.ok(result.ok);
    return result.target;
}

/** 取失败原因 */
function reason(uri) {
    const result = parseInstallUri(uri, PLUGIN);
    assert.equal(result.ok, false, `expected failure: ${uri}`);
    assert.ok(!result.ok);
    return result.reason;
}

test("不带 tag 时指向仓库地址，按最新 Release 安装", () => {
    assert.deepEqual(target("siyuan://plugins/install-package/install?repo=TCOTC/install-package"), {
        repoKey: "tcotc/install-package",
        url: "https://github.com/tcotc/install-package",
    });
});

test("带 tag 时指向该 Release，供面板强制选中对应版本", () => {
    assert.deepEqual(target("siyuan://plugins/install-package/install?repo=TCOTC/install-package&tag=v0.4.6"), {
        repoKey: "tcotc/install-package",
        url: "https://github.com/tcotc/install-package/releases/tag/v0.4.6",
    });
});

test("仓库键统一小写，参数的顺序与百分号编码都不影响结果", () => {
    const expected = {
        repoKey: "tcotc/install-package",
        url: "https://github.com/tcotc/install-package",
    };
    assert.deepEqual(target("siyuan://plugins/install-package/install?repo=TCOTC%2FInstall-Package"), expected);
    assert.deepEqual(target("siyuan://plugins/install-package/install?repo=%20TCOTC/install-package%20"), expected);
    assert.deepEqual(target("siyuan://plugins/install-package/install?tag=&repo=TCOTC/install-package"), expected);
});

test("tag 支持带斜杠的写法，但不接受会拼出越界路径的 `..`", () => {
    assert.equal(
        target("siyuan://plugins/install-package/install?repo=a/b&tag=release/1.0").url,
        "https://github.com/a/b/releases/tag/release/1.0",
    );
    assert.equal(reason("siyuan://plugins/install-package/install?repo=a/b&tag=..%2F..%2Ffoo"), "invalidTag");
    assert.equal(reason("siyuan://plugins/install-package/install?repo=a/b&tag=a%20b"), "invalidTag");
});

test("web+siyuan 变体与带 fragment 的链接同样被接受", () => {
    assert.equal(
        target("web+siyuan://plugins/install-package/install?repo=a/b&tag=v1#frag").repoKey,
        "a/b",
    );
});

test("动作名必须是小写 install，缺省、为空或其它动作都拒绝", () => {
    assert.equal(reason("siyuan://plugins/install-package"), "unknownAction");
    assert.equal(reason("siyuan://plugins/install-package/"), "unknownAction");
    assert.equal(reason("siyuan://plugins/install-package/uninstall?repo=a/b"), "unknownAction");
    assert.equal(INSTALL_URI_ACTION, "install");
});

test("只接受指向本插件的链接", () => {
    assert.equal(reason("siyuan://plugins/other-plugin/install?repo=a/b"), "notThisPlugin");
    // 主机名大小写敏感：`new URL` 对非特殊协议不做小写归一
    assert.equal(reason("siyuan://Plugins/install-package/install?repo=a/b"), "notThisPlugin");
    // 第一段是插件的自定义页签类型时走内核自己的分支，不到这里
    assert.equal(reason("siyuan://plugins/install-packageinstall_package_panel?repo=a/b"), "notThisPlugin");
});

test("仓库参数必须是单斜杠的 owner/repo", () => {
    assert.equal(reason("siyuan://plugins/install-package/install"), "invalidRepo");
    assert.equal(reason("siyuan://plugins/install-package/install?repo=a"), "invalidRepo");
    assert.equal(reason("siyuan://plugins/install-package/install?repo=a/b/c"), "invalidRepo");
    assert.equal(reason("siyuan://plugins/install-package/install?repo=a%2Fb%2Fc"), "invalidRepo");
    assert.equal(reason("siyuan://plugins/install-package/install?repo=https://github.com/a/b"), "invalidRepo");
});

test("非思源协议或无法解析的输入按「不是思源链接」处理", () => {
    assert.equal(reason("https://github.com/a/b"), "notSiYuanUri");
    assert.equal(reason("siyuan://blocks/20221031001313-rk7sd0e"), "notThisPlugin");
    assert.equal(reason(""), "notSiYuanUri");
    assert.equal(reason("not a url"), "notSiYuanUri");
});
