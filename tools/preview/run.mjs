/**
 * 预览用例的运行器
 *
 * 一次调用完成：清理输出目录 → 让用例构建 bundle → 拼样式 → 起静态服务器 → 打印地址
 * → 等页面把断言结果回传 → 打印并按失败数退出。
 *
 * 用法（从插件根目录）：
 *   node tools/preview/run.mjs cases/repo-summary-preview.mjs [--siyuan <思源仓库>] [--port n] [--timeout ms]
 *
 * 因为要等浏览器打开页面，**用后台终端跑**：命令会先打印地址，之后再输出结果。
 *
 * 用例文件导出：
 *   title       页面标题
 *   suite       断言代码字符串（页面里可用 preview / report / sleep / waitUntil）
 *   build(outDir, tools)  写 bundle；`tools` 见下方 toolsForCase()
 *   extraCss    追加样式（可选）
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildPreviewBundle, pluginDir, writePreviewPage } from "./lib/harness.mjs";
import { assemblePreviewCss } from "./lib/css.mjs";
import { startPreviewServer } from "./lib/server.mjs";

const DEFAULTS = { port: 0, timeout: 120000, outDir: ".preview" };

function parseArgs(argv) {
    const options = { ...DEFAULTS, caseFile: "" };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--siyuan" || arg === "--port" || arg === "--timeout" || arg === "--out") {
            const value = argv[i + 1];
            if (value === undefined) {
                throw new Error(`缺少 ${arg} 的值`);
            }
            if (arg === "--siyuan") {
                options.siyuanDir = value;
            } else if (arg === "--port") {
                options.port = Number(value);
            } else if (arg === "--timeout") {
                options.timeout = Number(value);
            } else {
                options.outDir = value;
            }
            i += 1;
            continue;
        }
        if (arg.startsWith("--")) {
            throw new Error(`未知参数 ${arg}`);
        }
        options.caseFile = arg;
    }
    if (!options.caseFile) {
        throw new Error(
            "用法：node tools/preview/run.mjs <cases/xxx.mjs> [--siyuan <思源仓库>] [--port n] [--timeout ms]",
        );
    }
    return options;
}

/**
 * 解析用例路径：先按当前工作目录，再按 `tools/preview/`。
 * 后者是为了让 `pnpm run preview cases/xxx.mjs` 这种从插件根目录发起的写法直接可用
 */
function resolveCaseFile(caseFile) {
    const candidates = [path.resolve(process.cwd(), caseFile), path.resolve(pluginDir, "tools", "preview", caseFile)];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    throw new Error(`找不到用例文件 ${caseFile}（试过：\n  ${candidates.join("\n  ")}）`);
}

function toolsForCase(outDir) {
    return {
        pluginDir,
        outDir,
        buildPreviewBundle,
        writePreviewPage,
        assemblePreviewCss,
        /** 把插件根目录下的素材拷进预览目录，供页面按相对路径取用 */
        copyAsset(fileName, relTarget) {
            const target = path.join(outDir, relTarget);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(path.join(pluginDir, fileName), target);
            return relTarget;
        },
    };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const outDir = path.resolve(pluginDir, options.outDir);
    const casePath = resolveCaseFile(options.caseFile);
    const caseModule = await import(pathToFileURL(casePath).href);

    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    const tools = toolsForCase(outDir);
    await caseModule.build(outDir, tools);
    const cssInfo = caseModule.assembleCss
        ? caseModule.assembleCss(tools)
        : assemblePreviewCss({ outFile: path.join(outDir, "preview.css"), siyuanDir: options.siyuanDir });
    writePreviewPage({
        outDir,
        title: caseModule.title ?? path.basename(options.caseFile),
        suite: caseModule.suite ?? "",
        extraCss: caseModule.extraCss ?? "",
    });

    console.log(`预览用例：${caseModule.title ?? options.caseFile}`);
    console.log(
        cssInfo.hasSiYuanCss
            ? "样式：插件 SCSS + 思源 base.css + 主题变量（外观可信）"
            : `样式：仅插件 SCSS（外观不可信 —— ${cssInfo.reason}）`,
    );

    const server = await startPreviewServer({ root: outDir, port: options.port });
    console.log(`\n在浏览器里打开：${server.url}`);
    console.log(`结果会自动回传到本终端，最长等待 ${options.timeout} ms\n`);

    const lines = await Promise.race([
        server.results,
        new Promise((resolve) => {
            setTimeout(() => resolve(null), options.timeout);
        }),
    ]);
    server.close();

    if (lines === null) {
        console.error(`超时：${options.timeout} ms 内没有收到结果（预览地址 ${server.url}）`);
        process.exitCode = 2;
        return;
    }
    if (!Array.isArray(lines)) {
        console.error(`结果格式异常：${JSON.stringify(lines)}`);
        process.exitCode = 2;
        return;
    }
    for (const line of lines) {
        console.log(line);
    }
    process.exitCode = lines.some((line) => line.startsWith("FAIL")) ? 1 : 0;
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
});
