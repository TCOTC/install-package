/**
 * 用例：仓库摘要里的缩略图与点击放大（issue #14 第 3 点）
 *
 * 走的是**真实代码路径**：构造真实的 `RepoParser` → `refresh()` → `updateRepoInfoEl("resolved")`
 * → 真实模板 + `wireRawPreviewImages` → 真实 `imagePreview.ts` + 真实 DOM。
 * 只有外部依赖是桩（`siyuan.Dialog` 记录调用、GitHub 接口返回固定数据）。
 *
 * 桩与真实实现的三处**有意差异**（这里不覆盖它们，别误读成已验证）：
 * - `githubRawRootFileUrl` 返回预览服务器上的 `/assets/<repo>/<file>`（带上仓库名是为了
 *   不同仓库不共享素材；带上唯一 query 是避免缓存让「未结算」状态变得不确定），
 *   因此**真实 URL 拼接逻辑不在本用例范围内**
 * - `Dialog` 不渲染界面，只记录入参，故**对话框的观感与几何不在本用例范围内**
 * - `parseOwnerRepo` 直接返回桩数据，不请求 GitHub
 *
 * 三个仓库根目录分支都要跑到：`install-package` 的 `icon.png` 直接命中（首个候选）、
 * `preview` 只有 `preview.webp` 存在（按扩展名回退）、`absent` 一个都没有（全部失败）
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

        // query 每次自增：同一页面加载内 URL 唯一，避免命中缓存后 img.complete 立刻为真；
        // 路径里带上仓库名，不同仓库各自的素材互不影响
        __stub_github: `
var counter = 0;
exports.calls = [];
exports.repoInfo = ${JSON.stringify(REPO_INFO)};
exports.githubRawRootFileUrl = function (owner, repo, branch, file) {
    counter += 1;
    exports.calls.push([owner, repo, branch, file]);
    return "/assets/" + repo + "/" + file + "?v=" + counter;
};
exports.parseOwnerRepo = async function () { return exports.repoInfo; };
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
        "../infra/packageImage": "__real_packageImage",
        "./repoSummaryDom": "__real_repoSummaryDom",
        "./imagePreview": "__real_imagePreview",
    };

    const real = {
        __real_html: "src/infra/html.ts",
        __real_packageImage: "src/infra/packageImage.ts",
        __real_repoSummaryDom: "src/ui/repoSummaryDom.ts",
        __real_imagePreview: "src/ui/imagePreview.ts",
        __real_repoParser: "src/ui/repoParser.ts",
    };

    const entry = `
window.__preview = {
    RepoParser: req("__real_repoParser").RepoParser,
    packageImage: req("__real_packageImage"),
    imagePreview: req("__real_imagePreview"),
    dialog: req("__stub_siyuan"),
    github: req("__stub_github")
};
`;

    // install-package：icon.png 直接命中；preview 只放 webp，验证按扩展名回退。absent 一个都不放
    tools.copyAsset("icon.png", "assets/install-package/icon.png");
    tools.copyAsset("preview.webp", "assets/install-package/preview.webp");
    return tools.buildPreviewBundle({ outDir, stubs, alias, real, entry });
}

export const suite = `
const h = preview;
const app = document.getElementById("app");

const logs = [];
const log = {
    info: function (message) { logs.push(String(message)); },
    warn: function (message) { logs.push("WARN " + message); },
    error: function (message) { logs.push("ERR " + message); }
};

// 摘要块与占位符由面板创建，这里照抄一份；多个仓库各一套，互不干扰
function createSummary() {
    const mainEl = document.createElement("div");
    mainEl.className = "jcip-repo-summary fn__none";
    const placeholderEl = document.createElement("p");
    placeholderEl.className = "jcip-show__text--placeholder";
    placeholderEl.textContent = "填入 URL 后自动解析仓库信息";
    app.append(mainEl, placeholderEl);
    return { mainEl: mainEl, placeholderEl: placeholderEl };
}
function createParser(target, repo) {
    return new h.RepoParser({
        url: "https://github.com/TCOTC/" + repo,
        version: "",
        enableAfterInstall: true,
        repoKey: "",
        presetRepoKey: "",
        presetPull: "",
        presetInstalled: ""
    }, log, target.mainEl, target.placeholderEl, {});
}
// 预览页在后台标签里，loading=lazy 的图不会开始加载；测试里改为立即加载。
// 只动「是否懒加载」这个属性，不涉及被测逻辑
function loadEagerly(mainEl) {
    Array.prototype.forEach.call(mainEl.querySelectorAll("img[data-jcip-raw-img]"), function (img) {
        img.loading = "eager";
        img.src = img.getAttribute("src");
    });
}
// 逐个候选往下试是异步的，结算条件取「所有图片都不再 pending」
function imagesSettled(mainEl) {
    const images = Array.prototype.slice.call(mainEl.querySelectorAll("img[data-jcip-raw-img]"));
    return images.length > 0 && images.every(function (img) { return img.complete; });
}
function framesOf(mainEl) {
    return Array.prototype.slice.call(mainEl.querySelectorAll("[data-jcip-preview-frame]"));
}
function captionOf(frame) {
    return frame.getAttribute("data-jcip-preview-caption") || "";
}
function labelOf(frame) {
    // 标签是缩略图框的兄弟节点（同在 jcip-repo-summary__preview 里），不在框内
    return frame.parentElement.querySelector("[data-jcip-preview-label]").textContent;
}

const hit = createSummary();
await createParser(hit, "install-package").refresh();

report("解析成功后显示摘要、隐藏占位",
    hit.mainEl.classList.contains("fn__none") === false && hit.placeholderEl.classList.contains("fn__none"),
    "mainEl=" + hit.mainEl.className + "，placeholder=" + hit.placeholderEl.className);
report("仓库名与描述进入摘要",
    hit.mainEl.innerHTML.indexOf("TCOTC") > -1 && hit.mainEl.innerHTML.indexOf("测试仓库") > -1);
report("两个槽位都按扩展名顺序构造候选（PNG 在最前）",
    JSON.stringify(h.github.calls) === JSON.stringify(
        h.packageImage.packageImageFileNames("icon")
            .concat(h.packageImage.packageImageFileNames("preview"))
            .map(function (file) { return ["TCOTC", "install-package", "main", file]; })
    ),
    JSON.stringify(h.github.calls));

const frames = framesOf(hit.mainEl);
report("渲染出两个缩略图框", frames.length === 2, "frames=" + frames.length);
report("图片未结算前不可交互", frames.length === 2 && frames.every(function (frame) {
    return frame.getAttribute("aria-disabled") === "true" && frame.tabIndex === -1;
}), frames.map(function (frame) {
    return frame.getAttribute("aria-disabled") + " / tabIndex " + frame.tabIndex;
}).join("，"));
report("标题与可访问名都用首个候选的文件名，且没有未替换的占位符", frames.every(function (frame) {
    const caption = captionOf(frame);
    const label = frame.getAttribute("aria-label") || "";
    return caption === labelOf(frame) && caption !== "" && label.indexOf(caption) > -1 && label.indexOf("{name}") === -1;
}), frames.map(function (frame) { return frame.getAttribute("aria-label"); }).join(" | "));

loadEagerly(hit.mainEl);
const settled = await waitUntil(function () { return imagesSettled(hit.mainEl); }, 8000);
report("两张缩略图都已结算", settled);

const iconFrame = frames[0];
const prevFrame = frames[1];
const iconImg = iconFrame.querySelector("img");
const prevImg = prevFrame.querySelector("img");
report("icon.png 是首个候选，直接命中",
    iconImg.naturalWidth > 0 && (iconImg.getAttribute("src") || "").indexOf("/assets/install-package/icon.png") > -1,
    "src=" + iconImg.getAttribute("src") + "，naturalWidth=" + iconImg.naturalWidth);
report("preview 的 png / jpg / jpeg 都不存在，回退到 webp",
    prevImg.naturalWidth > 0 && (prevImg.getAttribute("src") || "").indexOf("/assets/install-package/preview.webp") > -1,
    "src=" + prevImg.getAttribute("src") + "，naturalWidth=" + prevImg.naturalWidth);
report("回退命中后标题、可见标签与可访问名都换成实际文件名",
    captionOf(prevFrame) === "preview.webp" && labelOf(prevFrame) === "preview.webp" &&
    (prevFrame.getAttribute("aria-label") || "").indexOf("preview.webp") > -1,
    "标题=" + captionOf(prevFrame) + "，标签=" + labelOf(prevFrame) + "，aria=" + prevFrame.getAttribute("aria-label"));
report("首个候选命中的槽位标题保持 icon.png",
    captionOf(iconFrame) === "icon.png" && labelOf(iconFrame) === "icon.png",
    "标题=" + captionOf(iconFrame) + "，标签=" + labelOf(iconFrame));

report("加载成功后转为可交互",
    iconFrame.classList.contains("jcip-repo-summary__preview-frame--ready") &&
    iconFrame.getAttribute("aria-disabled") === "false" && iconFrame.tabIndex === 0,
    "class=" + iconFrame.className + "，tabIndex=" + iconFrame.tabIndex);
report("可交互时光标提示放大", getComputedStyle(iconFrame).cursor === "zoom-in", getComputedStyle(iconFrame).cursor);
report("回退命中的那张同样可交互",
    prevFrame.classList.contains("jcip-repo-summary__preview-frame--ready") &&
    prevFrame.getAttribute("aria-disabled") === "false" && prevFrame.tabIndex === 0 &&
    getComputedStyle(prevFrame).cursor === "zoom-in",
    "class=" + prevFrame.className + "，tabIndex=" + prevFrame.tabIndex);
report("加载成功时不显示占位符",
    iconFrame.querySelector("[data-jcip-raw-missing]").classList.contains("fn__none") &&
    prevFrame.querySelector("[data-jcip-raw-missing]").classList.contains("fn__none"));

h.dialog.options.length = 0;
h.dialog.destroyed = 0;
iconFrame.dispatchEvent(new MouseEvent("click", { bubbles: true }));
report("点击缩略图打开预览", h.dialog.options.length === 1, "count=" + h.dialog.options.length);
const first = h.dialog.options[0];
report("对话框用缩略图的地址与文件名作为标题",
    !!first && first.content.indexOf("/assets/install-package/icon.png") > -1 && first.title === "icon.png",
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
report("回退命中的缩略图也能放大，标题是实际文件名",
    h.dialog.options.length === 1 && h.dialog.options[0].title === "preview.webp" &&
    h.dialog.options[0].content.indexOf("/assets/install-package/preview.webp") > -1,
    h.dialog.options.length === 1
        ? "title=" + h.dialog.options[0].title + "，content=" + h.dialog.options[0].content
        : "无对话框");

// 第三个仓库：默认分支根目录一个受支持的图片都没有，两个槽位逐级尝试后都应落到占位符
h.github.repoInfo = Object.assign({}, h.github.repoInfo, { repo: "absent" });
const absent = createSummary();
await createParser(absent, "absent").refresh();
loadEagerly(absent.mainEl);
const absentSettled = await waitUntil(function () { return imagesSettled(absent.mainEl); }, 8000);
const absentFrames = framesOf(absent.mainEl);
report("没有可用图片时两个槽位都结算为占位符",
    absentSettled && absentFrames.length === 2 && absentFrames.every(function (frame) {
        return !frame.classList.contains("jcip-repo-summary__preview-frame--ready") &&
            frame.getAttribute("aria-disabled") === "true" && frame.tabIndex === -1 &&
            frame.querySelector("img").classList.contains("fn__none") &&
            getComputedStyle(frame.querySelector("[data-jcip-raw-missing]")).display !== "none";
    }),
    absentFrames.map(function (frame) {
        return frame.className + " / tabIndex " + frame.tabIndex + " / " + frame.querySelector("img").className;
    }).join("，"));
report("全部候选都失败时标题仍是首个候选的文件名",
    absentFrames.map(captionOf).join(",") === "icon.png,preview.png",
    absentFrames.map(captionOf).join(","));

h.dialog.options.length = 0;
absentFrames.forEach(function (frame) { frame.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
report("加载失败的缩略图点击无反应", h.dialog.options.length === 0, "count=" + h.dialog.options.length);

h.imagePreview.openImagePreview("javascript:alert(1)", "x");
h.imagePreview.openImagePreview("/relative.png", "x");
report("非 http / https 地址不弹窗", h.dialog.options.length === 0, "count=" + h.dialog.options.length);
`;
