# tools/preview

把插件的**真实 UI 代码**跑在真实浏览器 DOM 里的最小脚手架，用于验证「逻辑无法用单元测试覆盖」的界面行为。

## 什么时候**不要**用它（先读这段）

绝大多数 UI 改动都不需要它。默认验证走这三条 + 请作者在内核里点一下：

```
cd app/../  # 插件根目录
pnpm run lint:check
pnpm run typecheck
pnpm test
```

**不要**为了「看一眼样式对不对」搭预览：本目录存在的意义是把搭环境的成本付一次，而不是让每个改动都走一遍它。
判断标准是「**错了的代价高，且单元测试够不着**」——例如事件接线、异步状态机、无障碍属性、
以及「加载失败与成功两条分支」这类只有真实 DOM 与真实网络才能区分的行为。

尤其不要用它来量几何。观感与尺寸看一眼就知道；用断言去量反而容易被页面缩放、
陈旧截图、字体差异带出假失败（这一点是踩过的坑）。

## 原理

```
用例文件 (cases/*.mjs)
   │  build(outDir, tools)        ── 用 lib/harness.mjs 把真实 TS 打成 bundle
   ▼
.preview/harness.js              ── 真实业务代码 + 桩，跑在页面里
.preview/index.html              ── 断言写在页面里，结果 POST 回 Node
.preview/preview.css             ── 插件 SCSS（可选拼上思源 base.css 与主题变量）
   │
   ▼  静态服务器 (lib/server.mjs)
浏览器打开 http://127.0.0.1:<port>/
   │  页面跑完断言 → POST /__results
   ▼
终端打印 PASS / FAIL，进程按失败数退出
```

关键设计是**结果回传**：断言跑在浏览器里，若不回传，终端就只拿到一个地址，
成败只能靠人肉看页面 —— 那样就等于没验证。

## 用法

从插件根目录用**后台终端**跑（命令要先打印地址，之后才输出结果）：

```powershell
node tools/preview/run.mjs cases/repo-summary-preview.mjs --siyuan d:/CodeProjects/siyuan
```

| 参数 | 说明 |
|---|---|
| `--siyuan <目录>` | 思源仓库根目录。给了会拼上 `app/stage/build/desktop/base.*.css` 与两套主题变量，外观才与真实界面一致；文件名带哈希，按通配找，**不要写死** |
| `--port <n>` | 端口，默认 0（由系统分配） |
| `--timeout <ms>` | 等结果回传的上限，默认 120000 |
| `--out <目录>` | 输出目录，默认 `<插件根>/.preview`（已 gitignore 与 eslint 忽略） |

没给 `--siyuan` 也能跑，插件 SCSS 自成一套；只是颜色会走变量缺省值、几何会失真，
运行器会在开头写明「外观不可信」。

## 写一个用例

用例文件导出 `title`、`suite`、`build(outDir, tools)`，可选 `extraCss`。`suite` 是页面里的断言代码，
可用 `preview`（bundle 暴露的入口）、`report(name, pass, detail)`、`sleep(ms)`、`waitUntil(fn, ms)`。

```js
export const title = "我的面板";

export function build(outDir, tools) {
    return tools.buildPreviewBundle({
        outDir,
        stubs: { __stub_i18n: `exports.i18n = ${JSON.stringify(zhCN)};` },
        real: { __real_panel: "src/ui/panel.ts" },
        alias: {
            "../infra/i18n": "__stub_i18n",   // 源码里用到的每个说明符都要给
            "../infra/desktop": "__stub_desktop",
        },
        entry: `window.__preview = { Panel: req("__real_panel").Panel };`,
    });
}

export const suite = `
const panel = new preview.Panel();
report("构造后显示表单", !!panel.element, "");
`;
```

三条约束，都来自踩过的坑：

1. **只换外部依赖，不改业务代码。** 要改逻辑才测得动，说明该逻辑该抽成纯函数、进 `tests/`
2 **`alias` 必须覆盖真实模块用到的每个导入说明符。** 漏了会在构建期直接报错并列出缺哪个 id ——
   这是刻意设计的：以前漏桩的表现是「页面一片空白」，没有任何线索
3. **`suite` 里不要用模板字符串**（`build` 用普通替换插入它），也不要出现 `</script>`

### 两个容易踩的环境事实

- 预览页常处于**后台标签**：`requestAnimationFrame` 不会触发（所以提供的是 `waitUntil` 而非 rAF），
  且 `loading="lazy"` 的图**不会开始加载**。需要图片结算时，在用例里把 `img.loading = "eager"` 并重设 `src`
  —— 只动懒加载开关，不涉及被测逻辑
- 浏览器可能有**页面缩放**：`getBoundingClientRect()` 与 `clientWidth` / `getComputedStyle()` 不在同一坐标系。
  真要比几何就用 `rect.width / clientWidth` 反推 scale 再换算；但见上文，几何本不该用断言来量

## 现有用例

| 用例 | 覆盖 |
|---|---|
| `cases/repo-summary-preview.mjs` | 仓库摘要缩略图：按扩展名依次尝试（首个候选命中 / 回退到 webp / 全部失败三条分支）、可交互性与无障碍属性、点击与键盘入口、空格拦截、对话框入参（issue #14 第 3 点） |
