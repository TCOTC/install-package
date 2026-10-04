/**
 * `ui/repoSummaryDom.ts` 的单元测试
 *
 * 测试直接 import 源码 TS：Node 24 起默认开启类型剥离，因此不需要额外的构建步骤或测试依赖
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { REPO_SUMMARY_ATTRS, isRepoSummaryRendered } from "../src/ui/repoSummaryDom.ts";

/** 摘要根节点的最小替身：`isRepoSummaryRendered` 只读这两个属性，不需要真实 DOM */
function summaryNode(isConnected, innerHTML) {
    return { isConnected, innerHTML };
}

test("摘要未写入内容时不视为已渲染", () => {
    // 面板初始化与每次 refresh 都会先清空摘要再同步版本状态，此前必然为空
    assert.equal(isRepoSummaryRendered(summaryNode(true, "")), false);
});

test("摘要脱离文档时不视为已渲染", () => {
    assert.equal(isRepoSummaryRendered(summaryNode(false, "")), false);
    assert.equal(isRepoSummaryRendered(summaryNode(false, '<div class="jcip-repo-summary__body"></div>')), false);
});

test("摘要写入内容后才视为已渲染", () => {
    assert.equal(isRepoSummaryRendered(summaryNode(true, '<div class="jcip-repo-summary__body"></div>')), true);
});

test("属性名与 index.scss 里的选择器保持同步", async () => {
    // CSS 不能 import TS，只有样式里用到的那个属性需要在这里兜住改名遗漏
    const scss = await readFile(new URL("../src/index.scss", import.meta.url), "utf8");
    assert.ok(
        scss.includes(REPO_SUMMARY_ATTRS.pickedVersionLink),
        `index.scss 缺少 [${REPO_SUMMARY_ATTRS.pickedVersionLink}] 选择器`,
    );
});
