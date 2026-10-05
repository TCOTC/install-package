/**
 * 解析思源协议里的一键安装链接
 *
 * 链接形态：`siyuan://plugins/<插件包名>/install?repo=owner/repo[&tag=v1.2.3]`
 *
 * 宿主（思源前端 `app/src/util/uri.ts`）按链接第一段路径与 `plugin.name` 精确匹配，命中后只往
 * 本插件自己的 eventBus 发 `open-siyuan-url-plugin` 事件，detail 里只有一个 `url` 字段，
 * 路径与参数全部由本模块解析。任何外部程序都能构造该链接，因此这里只接受「打开安装界面」
 * 这一种无破坏性的动作：仓库与 tag 都按白名单校验，也不接收「安装后启用」之类的开关
 * （否则第三方链接可以让任意包在装完以后立即执行代码）
 *
 * 本模块只依赖 `URL` 与仓库键工具，不触碰 window / siyuan，可直接在 Node 下测试
 */

import { normalizeRepoKey } from "../infra/repoKey";

/** 链接里的动作名：`siyuan://plugins/<包名>/install?...` */
export const INSTALL_URI_ACTION = "install";

/** 仓库键：一段 owner、一个斜杠、一段 repo，不接受多余斜杠与空白 */
const OWNER_REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * Release tag 白名单：允许 GitHub tag 常见的字符与 `/` 分段，但整串不含 `..`
 *
 * `..` 会被排除，避免拼出越出 `releases/tag/` 的路径；`?`、`#`、空格等会破坏链接的字符由字符集挡掉
 */
const TAG_PATTERN = /^(?!.*\.\.)[A-Za-z0-9._+/-]+$/;

/** 解析失败的原因；调用方据此决定是否提示用户，并写进日志便于排查 */
export type InstallUriFailure =
    /** 不是思源协议链接 */
    | "notSiYuanUri"
    /** 链接里的插件包名不是本插件（宿主理论上不会转发过来，此处兜底忽略） */
    | "notThisPlugin"
    /** 动作名不是 `install`，例如 `siyuan://plugins/install-package` */
    | "unknownAction"
    /** 缺少 `repo` 参数或格式不合法 */
    | "invalidRepo"
    /** `tag` 参数存在但格式不合法 */
    | "invalidTag";

/** 解析成功得到的安装目标 */
export interface InstallUriTarget {
    /** 规范仓库键（小写 `owner/repo`），供安装面板按包复用页签 */
    repoKey: string;
    /** 交给安装面板的仓库地址；带 tag 时指向该 Release，面板据此强制选中对应版本 */
    url: string;
}

export type InstallUriResult = { ok: true; target: InstallUriTarget } | { ok: false; reason: InstallUriFailure };

/** 按宿主相同的口径取链接第一段路径：百分号编码解不开时按原样比较 */
function pluginNameFromUri(uri: URL): string {
    const segment = uri.pathname.split("/")[1] ?? "";
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

/**
 * 解析思源协议里的一键安装链接
 *
 * @param rawUri 事件 detail 里的原始链接（宿主传的是 `URL.href`）
 * @param pluginName 本插件包名（`plugin.name`），用于确认链接指向本插件
 */
export function parseInstallUri(rawUri: string, pluginName: string): InstallUriResult {
    let uri: URL;
    try {
        uri = new URL(rawUri);
    } catch {
        return { ok: false, reason: "notSiYuanUri" };
    }
    if (uri.protocol !== "siyuan:" && uri.protocol !== "web+siyuan:") {
        return { ok: false, reason: "notSiYuanUri" };
    }
    // 主机名大小写敏感：`new URL` 对非特殊协议不做小写归一，与宿主的判定保持一致
    if (uri.hostname !== "plugins") {
        return { ok: false, reason: "notThisPlugin" };
    }
    if (pluginNameFromUri(uri) !== pluginName) {
        return { ok: false, reason: "notThisPlugin" };
    }
    // 尾部斜杠会让这一段的取值为空串而不是 undefined，两者都按「无动作」处理
    if ((uri.pathname.split("/")[2] ?? "") !== INSTALL_URI_ACTION) {
        return { ok: false, reason: "unknownAction" };
    }
    const repo = (uri.searchParams.get("repo") ?? "").trim();
    if (!OWNER_REPO_PATTERN.test(repo)) {
        return { ok: false, reason: "invalidRepo" };
    }
    const tag = (uri.searchParams.get("tag") ?? "").trim();
    if (tag !== "" && !TAG_PATTERN.test(tag)) {
        return { ok: false, reason: "invalidTag" };
    }
    const repoKey = normalizeRepoKey(repo);
    return {
        ok: true,
        target: {
            repoKey,
            // 带 tag 时给 `releases/tag` 地址，复用「Release 链接强制选中该版本」的既有链路；
            // tag 不存在时面板会记一条告警并回退到最新 Release
            url: tag === "" ? `https://github.com/${repoKey}` : `https://github.com/${repoKey}/releases/tag/${tag}`,
        },
    };
}
