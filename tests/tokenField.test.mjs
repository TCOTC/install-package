/**
 * `settings/tokenField.ts` 的单元测试
 *
 * 测试直接 import 源码 TS：Node 24 起默认开启类型剥离，因此不需要额外的构建步骤或测试依赖
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { TOKEN_FIELD_CLASS, TOKEN_REVEAL_CLASS, supportsTextSecurity } from "../src/settings/tokenField.ts";

/** `CSS` 替身：只回应指定结果，同时记录被问到的属性与取值；`result` 为 Error 时模拟抛错 */
function fakeCss(result) {
    const asked = [];
    return {
        asked,
        supports(property, value) {
            asked.push([property, value]);
            if (result instanceof Error) {
                throw result;
            }
            return result;
        },
    };
}

test("缺少 CSS 对象或 supports 时按不支持处理", () => {
    assert.equal(supportsTextSecurity(undefined), false);
    assert.equal(supportsTextSecurity(null), false);
    assert.equal(supportsTextSecurity({}), false);
    assert.equal(supportsTextSecurity({ supports: "not a function" }), false);
});

test("按 -webkit-text-security: disc 探测支持情况", () => {
    const supported = fakeCss(true);
    assert.equal(supportsTextSecurity(supported), true);
    assert.deepEqual(supported.asked, [["-webkit-text-security", "disc"]]);

    const unsupported = fakeCss(false);
    assert.equal(supportsTextSecurity(unsupported), false);
    assert.deepEqual(unsupported.asked, [["-webkit-text-security", "disc"]]);
});

test("supports 抛错时按不支持处理", () => {
    // 个别实现对不规范的属性名会直接抛错，不能让它冒泡到设置面板的构造过程
    assert.equal(supportsTextSecurity(fakeCss(new Error("Invalid property"))), false);
});

test("只认严格 true，其余返回值按不支持处理", () => {
    assert.equal(supportsTextSecurity(fakeCss(undefined)), false);
    assert.equal(supportsTextSecurity(fakeCss("true")), false);
    assert.equal(supportsTextSecurity(fakeCss(1)), false);
});

test("类名与 index.scss 里的选择器保持同步", async () => {
    // CSS 不能 import TS，类名写错会让令牌以明文显示，属于看不见的泄漏
    const scss = await readFile(new URL("../src/index.scss", import.meta.url), "utf8");
    // 基础类要写成独立选择器：只查子串的话，会被「修饰类含同名前缀」蒙混过去
    assert.ok(
        new RegExp(`\\.${TOKEN_FIELD_CLASS}\\s*\\{`).test(scss),
        `index.scss 缺少 .${TOKEN_FIELD_CLASS} 基础选择器`,
    );
    assert.ok(scss.includes(`.${TOKEN_REVEAL_CLASS}`), `index.scss 缺少 .${TOKEN_REVEAL_CLASS} 选择器`);
});
