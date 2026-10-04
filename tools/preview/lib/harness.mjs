/**
 * 预览脚手架：把插件的**真实 TS 模块**打成浏览器能跑的 bundle
 *
 * 为什么需要它：插件的面板代码引用了 `siyuan` / `window` / 网络，无法用 `node --test` 直接跑；
 * 而 UI 逻辑（事件接线、加载状态、文案）又只有在真实 DOM 里才成立。这里做的事就是
 * 「用 typescript 把真实源码转成 CJS → 把导入说明符换成桩 id → 拼成一个自足的注册表 bundle」，
 * 页面里 `window.__preview` 直接拿到**没被改写过的**业务代码。
 *
 * 两条纪律（都是踩过的坑）：
 * - **只换掉外部依赖，不改业务代码**。要改逻辑才能测得动，说明该逻辑该被抽成纯函数、进 `tests/`
 * - **构建时校验每个 `require` 都有对应模块**。缺桩是这里最高频的失败，且表现为
 *   「页面一片空白」这种无信息量的现象；宁可构建期直接抛错并列出缺哪些 id
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** 插件仓根目录（本文件位于 `<root>/tools/preview/lib/`） */
export const pluginDir = fileURLToPath(new URL("../../../", import.meta.url));

const require = createRequire(new URL("../../../package.json", import.meta.url));
const ts = require("typescript");

function transpile(source, fileName) {
    return ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
        },
        fileName,
    }).outputText;
}

/** 只改 import / require / 动态 import 的说明符，不做全文替换（避免误伤字符串字面量） */
function rewriteSpecifiers(source, alias) {
    return source.replace(
        /(\bfrom\s*|\brequire\(\s*|\bimport\(\s*)(["'])([^"']+)\2/g,
        (match, lead, quote, specifier) => {
            const target = alias[specifier];
            return target === undefined ? match : `${lead}${quote}${target}${quote}`;
        },
    );
}

const REQUIRE_RE = /require\(\s*["']([^"']+)["']\s*\)/g;

/**
 * 生成预览 bundle
 *
 * @param outDir 输出目录（通常是 `<插件根>/.preview`，已被 gitignore 与 eslint 忽略）
 * @param real 真实模块：`{ 模块 id: 相对插件根的 ts 路径 }`
 * @param stubs 桩模块：`{ 模块 id: 源码字符串 }`
 * @param alias 导入说明符重写表：`{ 源码里的说明符: 模块 id }`；**每个真实模块用到的说明符都要给**
 * @param entry 注册完所有模块后执行的代码；可用 `req(id)` 取模块导出
 * @param bundleName 产物文件名
 */
export function buildPreviewBundle({ outDir, real = {}, stubs = {}, alias = {}, entry, bundleName = "harness.js" }) {
    const modules = [];
    for (const [id, code] of Object.entries(stubs)) {
        modules.push([id, code]);
    }
    for (const [id, relPath] of Object.entries(real)) {
        const absPath = path.join(pluginDir, relPath);
        if (!fs.existsSync(absPath)) {
            throw new Error(`预览构建失败：找不到真实模块 ${relPath}（id ${id}）`);
        }
        modules.push([id, transpile(rewriteSpecifiers(fs.readFileSync(absPath, "utf8"), alias), relPath)]);
    }

    // 构建期兜住「缺桩」：否则只会看到页面空白
    const registered = new Set(modules.map(([id]) => id));
    const missing = new Map();
    for (const [id, code] of modules) {
        for (const [, specifier] of code.matchAll(REQUIRE_RE)) {
            if (!registered.has(specifier)) {
                if (!missing.has(specifier)) {
                    missing.set(specifier, []);
                }
                missing.get(specifier).push(id);
            }
        }
    }
    if (missing.size > 0) {
        const detail = [...missing.entries()]
            .map(([specifier, users]) => `  ${specifier}  ← 被 ${users.join(", ")} 引用`)
            .join("\n");
        throw new Error(
            `预览构建失败：以下导入没有对应的模块 id，请在 alias / stubs 里补上\n${detail}\n` +
                "（alias 负责把源码里的说明符指到 id，stubs / real 负责登记 id 本身）",
        );
    }

    const body = modules
        .map(
            ([id, code]) =>
                `reg[${JSON.stringify(id)}] = (function () {\n` +
                "var exports = {};\n" +
                "var module = { exports: exports };\n" +
                "var require = req;\n" +
                `${code}\n` +
                "return module.exports;\n" +
                "})();",
        )
        .join("\n\n");

    const bundle = `(function () {
"use strict";
var reg = Object.create(null);
function req(id) {
    if (!(id in reg)) { throw new Error("preview harness: missing module " + id); }
    return reg[id];
}
${body}
(function () {
var exports = {};
var module = { exports: exports };
var require = req;
${entry ?? ""}
})();
})();`;

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, bundleName), bundle, "utf8");
    return { bundleName, moduleIds: [...registered] };
}

const PAGE_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN" data-mode="light">
<head>
<meta charset="utf-8">
<title>%%TITLE%%</title>
<link rel="stylesheet" href="/preview.css">
<style>
    body { margin: 0; padding: 16px; background: var(--b3-theme-background); color: var(--b3-theme-on-background); }
    #report { margin: 16px 0 0; padding: 12px; font: 12px/1.6 monospace; white-space: pre-wrap; }
    .pass { color: #2a7f3f }
    .fail { color: #c0392b }
%%EXTRA_CSS%%
</style>
</head>
<body>
<div id="app"></div>
<pre id="report"></pre>
<script src="/harness.js"></script>
<script>
var preview = window.__preview;
var results = [];
function report(name, pass, detail) {
    results.push({ name: name, pass: !!pass, detail: detail === undefined ? "" : String(detail) });
}
function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}
// 用 setTimeout 轮询而不是 requestAnimationFrame：预览页常在后台标签里，rAF 不会触发
async function waitUntil(predicate, timeoutMs) {
    var deadline = Date.now() + (timeoutMs === undefined ? 3000 : timeoutMs);
    while (Date.now() < deadline) {
        if (predicate()) { return true; }
        await sleep(20);
    }
    return false;
}
async function run() {
    try {
%%SUITE%%
    } catch (error) {
        report("用例抛出异常", false, error && error.stack ? error.stack : String(error));
    }
    var failed = results.filter(function (item) { return !item.pass; });
    var lines = results.map(function (item) {
        return (item.pass ? "PASS " : "FAIL ") + item.name + (item.detail ? " | " + item.detail : "");
    });
    lines.push("");
    lines.push(failed.length === 0 ? "ALL PASS (" + results.length + ")" : failed.length + " FAILED");
    var text = lines.join("\\n");
    document.getElementById("report").textContent = text;
    window.__previewResults = lines;
    try {
        await fetch("/__results", { method: "POST", body: JSON.stringify(lines) });
    } catch (error) {
        document.getElementById("report").textContent += "\\n（结果回传失败：" + error + "）";
    }
}
run();
</script>
</body>
</html>
`;

/**
 * 生成预览页
 *
 * @param outDir 与 `buildPreviewBundle` 相同的输出目录
 * @param title 页面标题
 * @param suite 断言代码（页面里可用 `preview` / `report` / `sleep` / `waitUntil`）；
 *              不要出现 `</script>`，也不要用模板字符串（本函数用普通替换插入它）
 * @param extraCss 追加到页面 `<style>` 里的样式（可选）
 */
export function writePreviewPage({ outDir, title, suite, extraCss = "" }) {
    const html = PAGE_TEMPLATE.replace("%%TITLE%%", () => title)
        .replace("%%EXTRA_CSS%%", () => extraCss)
        .replace("%%SUITE%%", () => suite);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "index.html"), html, "utf8");
}
