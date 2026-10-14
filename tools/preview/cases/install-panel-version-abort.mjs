/**
 * 用例：安装面板「选好 tag → 安装 → 安装中切换 tag → 中断 → 再安装」时，第二次安装用的是哪个 tag
 *
 * 走真实代码：真实 `InstallPanel` + 真实 `InstallPanelVersion` + 真实 `uiStore` + 真实 `installSession`
 * + 真实日志渲染。只有外部依赖是桩（`siyuan.Menu`、GitHub 接口、下载、内核安装、i18n 等）。
 *
 * 断言落在两处「装的是哪个版本」的最终事实：向 GitHub 请求的 Release tag（`github.releaseCalls`）
 * 与安装历史记录的 tag（`history.entries`）；另外把面板日志打出来，便于核对 `version=[...]` 一行。
 *
 * 桩与真实实现的有意差异（不在本用例范围内，别误读成已验证）：
 * - `getReleaseInfo` 不请求 GitHub，按传入 tag 直接返回一个带 `package.zip` 的 Release
 * - `downloadPackage` 不真的下载，挂起等待用例放行；`installPackage` 不真的交给内核
 */

import fs from "node:fs";
import path from "node:path";

export const title = "安装面板：安装中切 tag / 中断 / 再安装";

export function build(outDir, tools) {
    const zhCN = JSON.parse(fs.readFileSync(path.join(tools.pluginDir, "src", "i18n", "zh-CN.json"), "utf8"));

    const stubs = {
        __stub_i18n: `exports.i18n = ${JSON.stringify(zhCN)};`,

        __stub_empty: "exports.__unused = true;",

        // 只实现 version.ts / panel.ts 用到的那几件事：open / addItem(empty 的 bind) / close / element
        __stub_siyuan: `
exports.lastMenu = null;
exports.menus = [];
exports.Menu = function (id, closeCB) {
    this.id = id;
    this.closeCB = closeCB;
    this.isOpen = false;
    this.element = document.createElement("div");
    this.element.className = "b3-menu";
    this.element.setAttribute("data-name", id);
    this.itemsEl = document.createElement("div");
    this.itemsEl.className = "b3-menu__items";
    this.element.appendChild(this.itemsEl);
    document.body.appendChild(this.element);
    exports.menus.push(this);
    exports.lastMenu = this;
};
exports.Menu.prototype.addItem = function (options) {
    const el = document.createElement("button");
    el.className = "b3-menu__item";
    const label = options && typeof options.label === "string" ? options.label : "";
    if (options && options.type === "empty") {
        el.innerHTML = label;
    } else {
        el.textContent = label;
    }
    this.itemsEl.appendChild(el);
    if (options && typeof options.bind === "function") { options.bind(el); }
    if (options && typeof options.click === "function") {
        el.addEventListener("click", function () { options.click(); });
    }
    return el;
};
exports.Menu.prototype.addSeparator = function () {
    const el = document.createElement("div");
    el.className = "b3-menu__separator";
    this.itemsEl.appendChild(el);
};
exports.Menu.prototype.open = function () { this.isOpen = true; };
exports.Menu.prototype.close = function () {
    this.isOpen = false;
    if (typeof this.closeCB === "function") { this.closeCB(); }
};
exports.Menu.prototype.remove = function () { this.close(); };
`,

        __stub_desktop: `exports.electron = undefined;
exports.openDirectory = function () { return Promise.resolve(); };
exports.toggleDevTools = function () {};`,

        __stub_message: `exports.messages = [];
exports.message = function (text) { exports.messages.push(String(text)); };`,

        __stub_dialog: "exports.confirmDialog = function () { return Promise.resolve(true); };",

        // 记录每次按 tag 取 Release；installSession 与 repoParser 都从这里进
        __stub_github: `
exports.releaseCalls = [];
exports.tagInfo = {};
exports.setTagInfo = function (tag, info) { exports.tagInfo[tag] = info; };
exports.getReleaseInfo = function (owner, repo, version, log, signal) {
    exports.releaseCalls.push([owner, repo, version]);
    const info = exports.tagInfo[version] || {};
    return Promise.resolve({
        tag_name: version,
        published_at: "2026-01-01T00:00:00Z",
        prerelease: info.prerelease === true,
        assets: [{ id: 100, name: "package.zip", size: 1024, browser_download_url: "https://example.invalid/" + version + "/package.zip" }],
    });
};
exports.findPackageZip = function (assets) { return assets[0]; };
exports.GITHUB_RELEASES_PER_PAGE = 30;
exports.listReleasesPage = function () { return Promise.resolve(null); };
exports.mergeInstallReleasePages = function (pages) { return pages[0]; };
exports.fallbackLatestTagFromRows = function (rows) { return rows.length > 0 ? rows[0].tag : null; };
`,

        // 下载挂起等待用例放行；中断时以 aborted 结算（与真实实现一致）
        __stub_download: `
exports.calls = [];
exports.pending = [];
exports.downloadPackage = function (url, fileName, log, installAbort, options) {
    exports.calls.push({ url: url, fileName: fileName, tag: url.indexOf("https://example.invalid/") === 0 ? url.split("/")[3] : "" });
    return new Promise(function (resolve) {
        const entry = { url: url, settled: false };
        entry.settle = function (ok) {
            if (entry.settled) { return; }
            entry.settled = true;
            if (ok) {
                resolve({ ok: true, blob: new Blob(["PK"]), fileName: fileName, repoPackageName: "demo-pkg" });
            } else {
                resolve({ ok: false, reason: "aborted", loadedBytes: 0, totalBytes: options && options.totalBytes || 0 });
            }
        };
        exports.pending.push(entry);
        installAbort.signal.addEventListener("abort", function () { entry.settle(false); });
    });
};
`,

        __stub_install: `
exports.calls = [];
exports.completed = [];
exports.hold = false;
exports.held = [];
exports.installPackage = function (result, log) {
    exports.calls.push({ fileName: result.fileName, size: result.blob.size });
    if (!exports.hold) {
        exports.completed.push(exports.calls.length);
        return Promise.resolve({ packageType: "plugin", packageName: "demo-pkg" });
    }
    return new Promise(function (resolve) {
        exports.held.push(function () {
            exports.completed.push(exports.calls.length);
            resolve({ packageType: "plugin", packageName: "demo-pkg" });
        });
    });
};
exports.releaseHeld = function () {
    var next = exports.held.shift();
    if (next) { next(); }
};
exports.setPackageEnabled = function () { return Promise.resolve(true); };
`,

        __stub_history: `
exports.entries = [];
exports.recordInstallHistory = function (owner, repo, tag) {
    exports.entries.push([owner, repo, tag]);
    return Promise.resolve();
};
exports.ensureInstallHistoryLoaded = function () { return Promise.resolve(); };
exports.listInstallHistory = function () { return []; };
exports.clearInstallHistory = function () { return Promise.resolve(); };
exports.removeInstallHistoryEntry = function () { return Promise.resolve(); };
exports.installHistoryUrl = function (entry) { return "https://github.com/" + entry.owner + "/" + entry.repo; };
`,

        __stub_self: `
exports.getSelfPackageInfo = function () { return Promise.resolve(null); };
exports.isSelfRepoKeySync = function () { return false; };
exports.reportSelfInstallBlock = function () { return ""; };
exports.isSelfRepo = function () { return Promise.resolve(false); };
exports.MIN_SELF_INSTALL_VERSION = "1.0.0";
exports.isSelfInstallableVersion = function () { return true; };
exports.selfInstallVersionTooOldText = function (tag) { return "too old: " + tag; };
`,

        __stub_packageDetail: "exports.openPackageDetailPage = function () {};",

        __stub_installedPackageUi: `
exports.iconButton = function (iconId, label, action) {
    const el = document.createElement("button");
    el.className = "block__icon block__icon--show";
    el.dataset.action = action;
    el.setAttribute("aria-label", label);
    return el;
};
`,

        __stub_languageMenu: "exports.openInterfaceLanguageMenu = function () {};",

        __stub_panelUninstall: `
exports.petalDirPath = function (name) { return "data/storage/petal/" + name; };
exports.PanelUninstallTargets = function (pluginName, log, onChanged) {
    this.pluginName = pluginName;
    this.log = log;
    this.onChanged = onChanged;
    this.first = undefined;
    exports.instance = this;
};
exports.PanelUninstallTargets.prototype.setRepoKey = function () {};
exports.PanelUninstallTargets.prototype.hasPetalDir = function () { return false; };
exports.PanelUninstallTargets.prototype.applyPackageChange = function () {};
exports.PanelUninstallTargets.prototype.invalidate = function () {};
exports.PanelUninstallTargets.prototype.uninstall = function () { return Promise.resolve(); };
exports.PanelUninstallTargets.prototype.destroy = function () {};
`,

        __stub_compareLog: `
exports.PackageCompareLogger = function () {};
exports.PackageCompareLogger.prototype.log = function () {};
`,

        // 真实的 RepoParser 会打 GitHub 接口；这里换成可用例驱动的替身，事件形状与真实一致
        __stub_repoParser: `
exports.instances = [];
exports.ownerRepo = null;
exports.last = null;
exports.RepoParser = function (data, log, mainEl, placeholderEl, hooks) {
    this.data = data;
    this.hooks = hooks;
    exports.instances.push(this);
    exports.last = this;
};
exports.RepoParser.prototype.refresh = function () { return Promise.resolve(); };
exports.RepoParser.prototype.getOwnerRepo = function () { return Promise.resolve(exports.ownerRepo); };
exports.RepoParser.prototype.getResolvedInfo = function () { return null; };
exports.RepoParser.prototype.destroy = function () {};
exports.RepoParser.prototype.emitSettled = function (ownerRepo) {
    this.hooks.onRepoParseEvent({ type: "settled", data: ownerRepo });
};
exports.RepoParser.prototype.emitFetchStart = function () {
    this.hooks.onRepoReleasesEvent({ type: "fetchStart" });
};
exports.RepoParser.prototype.emitReleases = function (payload) {
    this.hooks.onRepoReleasesEvent({ type: "data", data: payload });
};
`,
    };

    const alias = {
        siyuan: "__stub_siyuan",
        "../infra/i18n": "__stub_i18n",
        "./i18n": "__stub_i18n",
        "../infra/html": "__real_html",
        "../infra/repoKey": "__real_repoKey",
        "../infra/message": "__stub_message",
        "../infra/desktop": "__stub_desktop",
        "../infra/dialog": "__stub_dialog",
        "../infra/packageLabels": "__real_packageLabels",
        "../github/github": "__stub_github",
        "../github/download": "__stub_download",
        "../github/bazaarPrs": "__stub_empty",
        "../install/install": "__stub_install",
        "../install/installSession": "__real_installSession",
        "../install/installHistory": "__stub_history",
        "../install/selfPackage": "__stub_self",
        "../install/packageDetail": "__stub_packageDetail",
        "../install/packageChange": "__stub_empty",
        // installSession 位于 src/install/ 内，用的是同目录说明符
        "./install": "__stub_install",
        "./installHistory": "__stub_history",
        "./selfPackage": "__stub_self",
        "./repoParser": "__stub_repoParser",
        "./version": "__real_version",
        "./uiStore": "__real_uiStore",
        "./panelData": "__real_panelData",
        "./panelPersistence": "__real_panelPersistence",
        "./installProgressButton": "__real_installProgressButton",
        "./logger": "__real_logger",
        "./installLogCopy": "__real_installLogCopy",
        "./languageMenu": "__stub_languageMenu",
        "./menuItem": "__real_menuItem",
        "./packageCompareLog": "__stub_compareLog",
        "./panelUninstall": "__stub_panelUninstall",
        "./installedPackageUi": "__stub_installedPackageUi",
        "./icons": "__real_icons",
        "./bazaarPullLabels": "__real_bazaarPullLabels",
        "./repoSummaryDom": "__real_repoSummaryDom",
        "./upDownHint": "__real_upDownHint",
        "./panelHost": "__stub_empty",
    };

    // 顺序即注册顺序：CJS 的 require 在模块体顶部执行，被依赖的必须排在前面
    const real = {
        __real_html: "src/infra/html.ts",
        __real_repoKey: "src/infra/repoKey.ts",
        __real_icons: "src/ui/icons.ts",
        __real_menuItem: "src/ui/menuItem.ts",
        __real_upDownHint: "src/ui/upDownHint.ts",
        __real_repoSummaryDom: "src/ui/repoSummaryDom.ts",
        __real_packageLabels: "src/infra/packageLabels.ts",
        __real_panelData: "src/ui/panelData.ts",
        __real_panelPersistence: "src/ui/panelPersistence.ts",
        __real_installProgressButton: "src/ui/installProgressButton.ts",
        __real_logger: "src/ui/logger.ts",
        __real_installLogCopy: "src/ui/installLogCopy.ts",
        __real_bazaarPullLabels: "src/ui/bazaarPullLabels.ts",
        __real_installSession: "src/install/installSession.ts",
        __real_uiStore: "src/ui/uiStore.ts",
        __real_version: "src/ui/version.ts",
        __real_panel: "src/ui/panel.ts",
    };

    const entry = `
window.__preview = {
    InstallPanel: req("__real_panel").InstallPanel,
    repoParser: req("__stub_repoParser"),
    github: req("__stub_github"),
    download: req("__stub_download"),
    install: req("__stub_install"),
    history: req("__stub_history"),
    siyuan: req("__stub_siyuan"),
    message: req("__stub_message")
};
`;

    return tools.buildPreviewBundle({ outDir, stubs, alias, real, entry });
}

export const suite = `
const h = preview;
const OWNER = "tcoto";
const REPO = "demo-pkg";
const NEW_TAG = "v1.0.1";
const OLD_TAG = "v1.0.0";

function rowOf(tag) {
    return { tag: tag, publishedAt: "2026-01-01T00:00:00Z", packageZipAt: "2026-01-01T00:00:00Z", prerelease: false };
}

function makePanel() {
    const hostEl = document.createElement("div");
    hostEl.style.width = "1000px";
    document.getElementById("app").appendChild(hostEl);
    const panel = new h.InstallPanel({
        element: hostEl,
        data: { url: "https://github.com/" + OWNER + "/" + REPO },
        setTitle: function () {},
        persist: function () {}
    }, "install-package");
    const parser = h.repoParser.last;
    h.repoParser.ownerRepo = { owner: OWNER, repo: REPO };
    parser.emitSettled({ owner: OWNER, repo: REPO });
    parser.emitReleases({
        releases: [rowOf(NEW_TAG), rowOf(OLD_TAG)],
        latestTag: NEW_TAG,
        meta: { owner: OWNER, repo: REPO, initialPageFull: false, selfRepo: false }
    });
    return { hostEl: hostEl, parser: parser };
}

function uiOf(hostEl) {
    return {
        versionEl: hostEl.querySelector("[data-type='version']"),
        installBtn: hostEl.querySelectorAll("button[data-type='install']")[0],
        abortBtn: hostEl.querySelectorAll("button[data-type='abort-install']")[0],
        logEl: hostEl.querySelector("[data-type='install-log']")
    };
}

function pickVersion(hostEl, tag) {
    uiOf(hostEl).versionEl.click();
    const row = h.siyuan.lastMenu.element.querySelector('.b3-list-item[data-version="' + tag + '"]');
    if (row) { row.click(); }
    return !!row;
}

/* ===== 场景一：下载中切 tag → 中断 → 再安装 ===== */
const a = makePanel();
await sleep(20);
const aUi = uiOf(a.hostEl);
const releaseCallsA = h.github.releaseCalls.length;
const pendingA = h.download.pending.length;

report("[一] 初始版本落到最新 tag", aUi.versionEl.textContent.indexOf(NEW_TAG) === 0, aUi.versionEl.textContent);
report("[一] 安装键初始可用", aUi.installBtn.disabled === false, "disabled=" + aUi.installBtn.disabled);

aUi.installBtn.click();
await waitUntil(function () { return h.download.pending.length === pendingA + 1; }, 3000);
report("[一] 第一次安装按最新 tag 取 Release",
    h.github.releaseCalls[releaseCallsA] && h.github.releaseCalls[releaseCallsA][2] === NEW_TAG,
    JSON.stringify(h.github.releaseCalls.slice(releaseCallsA)));

report("[一] 版本菜单能找到另一个 tag", pickVersion(a.hostEl, OLD_TAG), "");
await sleep(20);
report("[一] 切换后版本控件显示新选的 tag", aUi.versionEl.textContent.indexOf(OLD_TAG) === 0, aUi.versionEl.textContent);

aUi.abortBtn.click();
await waitUntil(function () { return aUi.installBtn.disabled === false; }, 3000);
report("[一] 中断后安装键恢复可用", aUi.installBtn.disabled === false, "disabled=" + aUi.installBtn.disabled);
report("[一] 中断后版本控件仍是新选的 tag", aUi.versionEl.textContent.indexOf(OLD_TAG) === 0, aUi.versionEl.textContent);

aUi.installBtn.click();
await waitUntil(function () { return h.github.releaseCalls.length === releaseCallsA + 2; }, 3000);
report("[一] 第二次安装按切换后的 tag 取 Release",
    h.github.releaseCalls[releaseCallsA + 1] && h.github.releaseCalls[releaseCallsA + 1][2] === OLD_TAG,
    JSON.stringify(h.github.releaseCalls.slice(releaseCallsA)));

await waitUntil(function () { return h.download.pending.length === pendingA + 2; }, 3000);
h.download.pending[pendingA + 1].settle(true);
await waitUntil(function () { return h.install.completed.length === 1; }, 3000);
report("[一] 安装历史记录的是切换后的 tag",
    h.history.entries.length === 1 && h.history.entries[0][2] === OLD_TAG,
    JSON.stringify(h.history.entries));
report("[一] 日志里第二次安装的 version= 是切换后的 tag",
    aUi.logEl.textContent.indexOf("version=[" + OLD_TAG + "]") >= 0,
    aUi.logEl.textContent);

/* ===== 场景二：下载已完成、进入内核安装阶段后再切 tag → 中断 → 再安装 ===== */
h.install.hold = true;
const b = makePanel();
await sleep(20);
const bUi = uiOf(b.hostEl);
const releaseCallsB = h.github.releaseCalls.length;
const pendingB = h.download.pending.length;
const installCallsB = h.install.calls.length;

bUi.installBtn.click();
await waitUntil(function () { return h.download.pending.length === pendingB + 1; }, 3000);
report("[二] 第一次安装按最新 tag 取 Release",
    h.github.releaseCalls[releaseCallsB] && h.github.releaseCalls[releaseCallsB][2] === NEW_TAG,
    JSON.stringify(h.github.releaseCalls.slice(releaseCallsB)));

// 放行下载 → 进入内核安装阶段（此时 installPackage 被挂住）
h.download.pending[pendingB].settle(true);
await waitUntil(function () { return h.install.calls.length === installCallsB + 1; }, 3000);
report("[二] 已进入内核安装阶段（下载已完成）", h.install.calls.length === installCallsB + 1, JSON.stringify(h.install.calls));
report("[二] 此时中断键已禁用（文案为「正在安装」）",
    bUi.abortBtn.disabled === true && bUi.abortBtn.textContent.indexOf("正在安装") >= 0,
    "disabled=" + bUi.abortBtn.disabled + " text=" + bUi.abortBtn.textContent);

report("[二] 版本控件此刻仍可切换", pickVersion(b.hostEl, OLD_TAG) === true, "");
await sleep(20);
report("[二] 切换后版本控件显示新选的 tag", bUi.versionEl.textContent.indexOf(OLD_TAG) === 0, bUi.versionEl.textContent);

// 用户按「中断安装」：按钮已禁用，点了没有任何反应
bUi.abortBtn.click();
await sleep(30);
report("[二] 中断键点了没反应（安装未被中止）", h.install.calls.length === installCallsB + 1, "installCalls=" + h.install.calls.length);
report("[二] 安装键此刻被隐藏且禁用（点它也没反应）",
    bUi.installBtn.classList.contains("fn__none") === true && bUi.installBtn.disabled === true,
    "class=" + bUi.installBtn.className + " disabled=" + bUi.installBtn.disabled);
bUi.installBtn.click();
await sleep(30);
report("[二] 点安装也没有发起新安装",
    h.github.releaseCalls.length === releaseCallsB + 1,
    JSON.stringify(h.github.releaseCalls.slice(releaseCallsB)));

// 内核安装完成：装下去的是进入内核阶段时那一版
h.install.releaseHeld();
await waitUntil(function () { return h.history.entries.length === 2; }, 3000);
report("[二] 装下去的是旧 tag，而版本控件显示的是新选的 tag",
    h.history.entries[1][2] === NEW_TAG && bUi.versionEl.textContent.indexOf(OLD_TAG) === 0,
    "历史=" + JSON.stringify(h.history.entries[1]) + " 控件=" + bUi.versionEl.textContent);
report("[二] 日志（供核对）", true, bUi.logEl.textContent);
`;
