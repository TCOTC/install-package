/**
 * 用例：仓库摘要里的缩略图与点击放大（issue #14 第 3 点）
 *
 * 走的是**真实代码路径**：构造真实的 `RepoParser` → `refresh()` → `updateRepoInfoEl("resolved")`
 * → 真实模板 + `wireRawPreviewImages` → 真实 `imagePreview.ts` + 真实 DOM。
 * 只有外部依赖是桩（`siyuan.Dialog` 记录调用、GitHub 接口返回固定数据）。
 *
 * 桩与真实实现的两处**有意差异**（这里不覆盖它们，别误读成已验证）：
 * - `githubRawRootFileUrl` 返回预览服务器上的 `/assets/<file>`（并带上唯一 query，避免缓存
 *   让「未结算」状态变得不确定），因此**真实 URL 拼接逻辑不在本用例范围内**
 * - `Dialog` 不渲染界面，只记录入参，故**对话框的观感与几何不在本用例范围内**
 */

import fs from "node:fs";
import path from "node:path";

export const title = "仓库摘要缩略图：加载状态与点击放大";

const REPO_INFO = {
    owner: "TCOTC",
    repo: "install-package",
    description: "测试仓库",
    stars: 12,
    ownerAvatarUrl: "",
    homepageUrl: "",
    defaultBranch: "main",
    licenseDisplay: "MIT",
    urlTag: null,
};

export function build(outDir, tools) {
    const zhCN = JSON.parse(fs.readFileSync(path.join(tools.pluginDir, "src", "i18n", "zh-CN.json"), "utf8"));

    const stubs = {
        __stub_i18n: `exports.i18n = ${JSON.stringify(zhCN)};`,

        // query 每次自增：同一页面加载内 URL 唯一，避免命中缓存后 img.complete 立刻为真
        __stub_github: `
var counter = 0;
exports.calls = [];
exports.githubRawRootFileUrl = function (owner, repo, branch, file) {
    counter += 1;
    exports.calls.push([owner, repo, branch, file]);
    return "/assets/" + file + "?v=" + counter;
};
exports.parseOwnerRepo = async function () { return ${JSON.stringify(REPO_INFO)}; };
exports.getReleaseInfo = async function () { return null; };
exports.listReleasesPage = async function () { return { rows: [], pageFull: false }; };
exports.mergeInstallReleasePages = function (pages) { return pages; };
exports.fallbackLatestTagFromRows = function () { return null; };
`,

        __stub_self: "exports.isSelfRepo = async function () { return false; };",

        __stub_siyuan: `
exports.options = [];
exports.destroyed = 0;
exports.Dialog = class {
    constructor(options) {
        this.options = options;
        exports.options.push(options);
    }
    destroy() {
        exports.destroyed += 1;
        if (this.options.destroyCallback) { this.options.destroyCallback(); }
    }
};
`,
    };

    const alias = {
        siyuan: "__stub_siyuan",
        "../infra/i18n": "__stub_i18n",
        "../infra/html": "__real_html",
        "../github/github": "__stub_github",
        "../install/selfPackage": "__stub_self",
        "./repoSummaryDom": "__real_repoSummaryDom",
        "./imagePreview": "__real_imagePreview",
    };

    const real = {
        __real_html: "src/infra/html.ts",
        __real_repoSummaryDom: "src/ui/repoSummaryDom.ts",
        __real_imagePreview: "src/ui/imagePreview.ts",
        __real_repoParser: "src/ui/repoParser.ts",
    };

    const entry = `
window.__preview = {
    RepoParser: req("__real_repoParser").RepoParser,
    imagePreview: req("__real_imagePreview"),
    dialog: req("__stub_siyuan"),
    github: req("__stub_github")
};
`;

    // icon.png 用插件自己的图标当素材（200）；preview.png 故意不放，验证 404 分支
    tools.copyAsset("icon.png", "assets/icon.png");
    return tools.buildPreviewBundle({ outDir, stubs, alias, real, entry });
}

export const suite = `
const h = preview;
const app = document.getElementById("app");
const mainEl = document.createElement("div");
mainEl.className = "jcip-repo-summary fn__none";
const placeholderEl = document.createElement("p");
placeholderEl.className = "jcip-show__text--placeholder";
placeholderEl.textContent = "填入 URL 后自动解析仓库信息";
app.append(mainEl, placeholderEl);

const logs = [];
const log = {
    info: function (message) { logs.push(String(message)); },
    warn: function (message) { logs.push("WARN " + message); },
    error: function (message) { logs.push("ERR " + message); }
};
const parser = new h.RepoParser({
    url: "https://github.com/TCOTC/install-package",
    version: "",
    enableAfterInstall: true,
    repoKey: "",
    presetRepoKey: "",
    presetPull: "",
    presetInstalled: ""
}, log, mainEl, placeholderEl, {});
await parser.refresh();

report("解析成功后显示摘要、隐藏占位",
    mainEl.classList.contains("fn__none") === false && placeholderEl.classList.contains("fn__none"),
    "mainEl=" + mainEl.className + "，placeholder=" + placeholderEl.className);
report("仓库名与描述进入摘要",
    mainEl.innerHTML.indexOf("TCOTC") > -1 && mainEl.innerHTML.indexOf("测试仓库") > -1);
report("owner / repo / 默认分支 / 文件名都传到了 URL 构造",
    JSON.stringify(h.github.calls) === JSON.stringify([
        ["TCOTC", "install-package", "main", "icon.png"],
        ["TCOTC", "install-package", "main", "preview.png"]
    ]),
    JSON.stringify(h.github.calls));

const frames = Array.prototype.slice.call(mainEl.querySelectorAll("[data-jcip-preview-frame]"));
report("渲染出两个缩略图框", frames.length === 2, "frames=" + frames.length);
report("图片未结算前不可交互", frames.length === 2 && frames.every(function (frame) {
    return frame.getAttribute("aria-disabled") === "true" && frame.tabIndex === -1;
}), frames.map(function (frame) {
    return frame.getAttribute("aria-disabled") + " / tabIndex " + frame.tabIndex;
}).join("，"));
report("可访问名带上文件名，且没有未替换的占位符", frames.every(function (frame) {
    const caption = frame.getAttribute("data-jcip-preview-caption") || "";
    const label = frame.getAttribute("aria-label") || "";
    return caption !== "" && label.indexOf(caption) > -1 && label.indexOf("{name}") === -1;
}), frames.map(function (frame) { return frame.getAttribute("aria-label"); }).join(" | "));

// 预览页在后台标签里，loading=lazy 的图不会开始加载；测试里改为立即加载。
// 只动「是否懒加载」这个属性，不涉及被测逻辑
Array.prototype.forEach.call(mainEl.querySelectorAll("img[data-jcip-raw-img]"), function (img) {
    img.loading = "eager";
    img.src = img.getAttribute("src");
});
const settled = await waitUntil(function () {
    const images = Array.prototype.slice.call(mainEl.querySelectorAll("img[data-jcip-raw-img]"));
    return images.length === 2 && images.every(function (img) { return img.complete; });
}, 5000);
report("两张缩略图都已结算", settled);

const iconFrame = mainEl.querySelector('[data-jcip-preview-frame][data-jcip-preview-caption="icon.png"]');
const prevFrame = mainEl.querySelector('[data-jcip-preview-frame][data-jcip-preview-caption="preview.png"]');
const iconImg = iconFrame.querySelector("img");
const prevImg = prevFrame.querySelector("img");
report("icon.png 加载成功、preview.png 加载失败（服务端 200 / 404）",
    iconImg.naturalWidth > 0 && prevImg.naturalWidth === 0,
    "icon=" + iconImg.naturalWidth + "，preview=" + prevImg.naturalWidth);

report("加载成功后转为可交互",
    iconFrame.classList.contains("jcip-repo-summary__preview-frame--ready") &&
    iconFrame.getAttribute("aria-disabled") === "false" && iconFrame.tabIndex === 0,
    "class=" + iconFrame.className + "，tabIndex=" + iconFrame.tabIndex);
report("可交互时光标提示放大", getComputedStyle(iconFrame).cursor === "zoom-in", getComputedStyle(iconFrame).cursor);
report("加载失败仍不可交互，且显示占位符",
    !prevFrame.classList.contains("jcip-repo-summary__preview-frame--ready") &&
    prevFrame.getAttribute("aria-disabled") === "true" && prevFrame.tabIndex === -1 &&
    getComputedStyle(prevFrame.querySelector("[data-jcip-raw-missing]")).display !== "none",
    "class=" + prevFrame.className + "，tabIndex=" + prevFrame.tabIndex);
report("加载成功时不显示占位符",
    iconFrame.querySelector("[data-jcip-raw-missing]").classList.contains("fn__none"));

h.dialog.options.length = 0;
h.dialog.destroyed = 0;
iconFrame.dispatchEvent(new MouseEvent("click", { bubbles: true }));
report("点击缩略图打开预览", h.dialog.options.length === 1, "count=" + h.dialog.options.length);
const first = h.dialog.options[0];
report("对话框用缩略图的地址与文件名作为标题",
    !!first && first.content.indexOf("/assets/icon.png") > -1 && first.title === "icon.png",
    first ? "title=" + first.title + "，content=" + first.content : "无对话框");
report("对话框宽度自适应内容", !!first && first.width === "fit-content", first ? String(first.width) : "无对话框");
report("图片容器带预览类名（样式依赖它）", !!first && first.content.indexOf("jcip-image-preview") > -1);

const enterEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
iconFrame.dispatchEvent(enterEvent);
const spaceEvent = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
iconFrame.dispatchEvent(spaceEvent);
report("回车与空格也能打开预览", h.dialog.options.length === 3, "count=" + h.dialog.options.length);
report("空格被拦下，不会滚动页面", spaceEvent.defaultPrevented, "defaultPrevented=" + spaceEvent.defaultPrevented);
report("连续打开会先收起上一次", h.dialog.destroyed === 2, "destroyed=" + h.dialog.destroyed);

h.dialog.options.length = 0;
h.dialog.destroyed = 0;
prevFrame.dispatchEvent(new MouseEvent("click", { bubbles: true }));
prevFrame.dispatchEvent(new MouseEvent("click", { bubbles: true }));
report("加载失败的缩略图点击无反应", h.dialog.options.length === 0, "count=" + h.dialog.options.length);

h.imagePreview.openImagePreview("javascript:alert(1)", "x");
h.imagePreview.openImagePreview("/relative.png", "x");
report("非 http / https 地址不弹窗", h.dialog.options.length === 0, "count=" + h.dialog.options.length);
`;
