/**
 * GitHub 仓库键（`owner/repo`）的归一化
 *
 * 元数据里的仓库地址、用户输入的 URL、集市 PR 标题与检查评论里的仓库写法各异：大小写不同、
 * 带或不带 `.git`、带 query 或多余斜杠。全插件统一用「owner 与 repo 均小写」的规范形式做
 * 匹配与缓存的键，因此集中在这里实现。
 *
 * 本模块只依赖 `URL`，不触碰 window / siyuan，可直接在 Node 下测试
 */

/** 由 owner / repo 得到规范仓库键；两侧统一小写 */
export function repoKeyFromOwnerRepo(owner: string, repo: string): string {
    return `${owner}/${repo}`.trim().toLowerCase();
}

/** 把已知形态的仓库键（如入口传入的 `owner/repo`）归一为规范写法 */
export function normalizeRepoKey(key: string): string {
    return key.trim().toLowerCase();
}

/**
 * 把仓库地址规范化为规范仓库键
 *
 * 用 `URL` 解析而非正则，query、`#`、尾随 `/`、冗余斜杠一并交给它；`.git` 后缀手动去掉。
 * 外部数据可能非法（实测有包的 url 只有 owner），非 github.com 或取不到仓库名时返回 null
 */
export function repoKeyOf(repoURL: string): string | null {
    let url: URL;
    try {
        url = new URL(repoURL);
    } catch {
        return null;
    }
    if (url.hostname.toLowerCase() !== "github.com") {
        return null;
    }
    // 空段一并滤掉，尾随斜杠与冗余斜杠都能得到同一结果
    const parts = url.pathname.split("/").filter((part) => part !== "");
    if (parts.length < 2) {
        return null;
    }
    const owner = parts[0].toLowerCase();
    const repo = parts[1].replace(/\.git$/i, "").toLowerCase();
    return owner !== "" && repo !== "" ? repoKeyFromOwnerRepo(owner, repo) : null;
}
