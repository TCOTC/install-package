/**
 * `ui/packageCompare.ts` 的单元测试
 *
 * 对比对话框的两列取值、缺失侧的兜底与版本后缀都是纯数据拼装，
 * 改错只会让对话框显示得不对，日常使用中很难发现，因此把这些规则固定下来
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
    buildPackageCompareRows,
    COMPARE_DASH,
    formatPackageCompareLog,
} from "../src/ui/packageCompare.ts";

const SUFFIXES = { latest: "（最新）", prerelease: "（预发布）" };

/** 与 i18n 的 `compareLogLine` 一致，仅用于断言日志行 */
const LOG_FORMAT = { line: "{label}：{local} ｜ {remote}", dash: COMPARE_DASH };

const LABELS = {
    name: "名称",
    version: "版本",
    type: "类型",
    author: "作者",
    description: "描述",
    repo: "仓库",
    installedAt: "安装时间",
    updatedAt: "更新时间",
    publishedAt: "发布时间",
    zipUploadedAt: "zip 上传时间",
    license: "许可证",
    stars: "星标",
};

/** 造一个本地已安装包；只填对比用到的字段 */
function local(overrides = {}) {
    return {
        kernelType: "plugins",
        type: "plugin",
        name: "install-package",
        displayName: "install-package",
        version: "1.0.0",
        author: "TCOTC",
        description: "本地描述",
        hInstallDate: "2026-06-15",
        repoURL: "https://github.com/TCOTC/install-package",
        repoKey: "tcotc/install-package",
        iconURL: "",
        installTime: 0,
        updateTime: 0,
        enabled: false,
        current: false,
        invalidReason: "",
        incompatible: false,
        disallowInstall: false,
        ...overrides,
    };
}

/** 造一份线上仓库信息 */
function remote(overrides = {}) {
    return {
        owner: "TCOTC",
        repo: "install-package",
        description: "线上描述",
        stars: 42,
        ownerAvatarUrl: "",
        homepageUrl: "https://example.com",
        defaultBranch: "main",
        licenseDisplay: "MIT",
        urlTag: null,
        ...overrides,
    };
}

function rowOf(rows, key) {
    const row = rows.find((item) => item.key === key);
    assert.ok(row, `缺少 ${key} 行`);
    return row;
}

const build = (input = {}) => buildPackageCompareRows({
    local: local(),
    remote: remote(),
    localTypeLabel: "插件",
    version: "1.0.0",
    latestTag: null,
    selectedRelease: null,
    ...input,
}, SUFFIXES);

test("两侧分别取各自的值", () => {
    const rows = build();
    assert.equal(rowOf(rows, "name").local, "install-package");
    assert.equal(rowOf(rows, "name").remote, "install-package");
    assert.equal(rowOf(rows, "version").local, "1.0.0");
    assert.equal(rowOf(rows, "type").local, "插件");
    assert.equal(rowOf(rows, "author").local, "TCOTC");
    assert.equal(rowOf(rows, "author").remote, "TCOTC");
    assert.equal(rowOf(rows, "description").local, "本地描述");
    assert.equal(rowOf(rows, "description").remote, "线上描述");
    assert.equal(rowOf(rows, "repo").local, "https://github.com/TCOTC/install-package");
    assert.equal(rowOf(rows, "repo").remote, "https://github.com/TCOTC/install-package");
    assert.equal(rowOf(rows, "installedAt").local, "2026-06-15");
    assert.equal(rowOf(rows, "license").remote, "MIT");
    assert.equal(rowOf(rows, "stars").remote, "42");
});

test("展示名与包名不同时补上包名", () => {
    const renamed = build({ local: local({ displayName: "别名" }) });
    assert.equal(rowOf(renamed, "name").local, "别名 (install-package)");
    const same = build({ local: local({ displayName: "install-package" }) });
    assert.equal(rowOf(same, "name").local, "install-package");
});

test("线上未解析成功时不编造线上取值，版本仍取面板选中的 tag", () => {
    const rows = build({ remote: null });
    for (const key of ["name", "author", "description", "repo", "license", "stars"]) {
        assert.equal(rowOf(rows, key).remote, "", `${key} 线上侧应为空`);
    }
    assert.equal(rowOf(rows, "version").remote, "1.0.0");
    assert.equal(rowOf(rows, "name").local, "install-package");
});

test("单侧独有的信息只在对应列出现", () => {
    const rows = build();
    for (const key of ["type", "installedAt", "updatedAt"]) {
        assert.equal(rowOf(rows, key).remote, "", `${key} 线上侧应为空`);
    }
    for (const key of ["publishedAt", "zipUploadedAt", "license", "stars"]) {
        assert.equal(rowOf(rows, key).local, "", `${key} 本地侧应为空`);
    }
});

test("版本与最新 tag 相同才补「（最新）」后缀", () => {
    assert.equal(rowOf(build({ latestTag: "1.0.0" }), "version").remote, "1.0.0（最新）");
    assert.equal(rowOf(build({ latestTag: "2.0.0" }), "version").remote, "1.0.0");
});

test("未选版本时线上版本为空", () => {
    assert.equal(rowOf(build({ version: "" }), "version").remote, "");
    assert.equal(rowOf(build({ version: "", latestTag: "" }), "version").remote, "");
});

test("预发布版本补「（预发布）」后缀，可与「（最新）」同时出现", () => {
    const release = { tag: "1.0.0", publishedAt: "2026-06-15T12:00:00Z", packageZipAt: "", prerelease: true };
    assert.equal(rowOf(build({ selectedRelease: release }), "version").remote, "1.0.0（预发布）");
    assert.equal(
        rowOf(build({ selectedRelease: release, latestTag: "1.0.0" }), "version").remote,
        "1.0.0（最新）（预发布）",
    );
});

test("发布时间取 Release 的 published_at，zip 上传时间取附件的 created_at", () => {
    assert.equal(rowOf(build(), "publishedAt").remote, "");
    assert.equal(rowOf(build(), "zipUploadedAt").remote, "");
    const blank = build({ selectedRelease: { tag: "1.0.0", publishedAt: "", packageZipAt: "", prerelease: false } });
    assert.equal(rowOf(blank, "publishedAt").remote, "");
    assert.equal(rowOf(blank, "zipUploadedAt").remote, "");
    const withAsset = build({
        selectedRelease: {
            tag: "1.0.0",
            publishedAt: "2026-06-15T12:00:00Z",
            packageZipAt: "2026-06-16T08:30:00Z",
            prerelease: false,
        },
    });
    assert.match(rowOf(withAsset, "publishedAt").remote, /2026/);
    assert.match(rowOf(withAsset, "zipUploadedAt").remote, /2026/);
    // 两者是不同的时间点，不能互相顶替
    assert.notEqual(rowOf(withAsset, "publishedAt").remote, rowOf(withAsset, "zipUploadedAt").remote);
});

test("更新时间只在有有效时间戳时展示", () => {
    assert.equal(rowOf(build({ local: local({ updateTime: 0 }) }), "updatedAt").local, "");
    const text = rowOf(build({
        local: local({ updateTime: Date.UTC(2026, 5, 15, 12) }),
    }), "updatedAt").local;
    assert.match(text, /2026/);
});

test("日志行：缩进两个空格，两侧用模板里的分隔符，缺的一侧显示占位", () => {
    const lines = formatPackageCompareLog(build(), LABELS, LOG_FORMAT);
    assert.equal(lines.length, 12);
    assert.equal(lines[0], "  名称：install-package ｜ install-package");
    assert.equal(lines[2], `  类型：插件 ｜ ${COMPARE_DASH}`);
    assert.equal(lines[8], `  发布时间：${COMPARE_DASH} ｜ ${COMPARE_DASH}`);
    assert.equal(lines[10], `  许可证：${COMPARE_DASH} ｜ MIT`);
    // 两侧都为空时不会漏掉分隔符，仍是完整的一行
    for (const line of lines) {
        assert.ok(line.startsWith("  "), `缺少缩进：${line}`);
        assert.ok(line.includes("｜"), `缺少分隔符：${line}`);
    }
});

test("日志行：两侧都有值时原样呈现，可长内容不截断", () => {
    const long = "描述".repeat(40);
    const lines = formatPackageCompareLog(
        build({ local: local({ description: long }) }),
        LABELS,
        LOG_FORMAT,
    );
    assert.ok(lines[4].includes(long));
    assert.ok(lines[4].startsWith("  描述："));
});

test("日志行：取值里出现占位符文本时不会被二次替换", () => {
    const tricky = "含 {remote} 与 {local} 的描述";
    const lines = formatPackageCompareLog(
        build({ local: local({ description: tricky }) }),
        LABELS,
        LOG_FORMAT,
    );
    assert.ok(lines[4].includes(tricky));
});
