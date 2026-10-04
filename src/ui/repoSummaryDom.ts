/**
 * 仓库摘要块的 DOM 契约
 *
 * `repoParser` 用 `innerHTML` 一次性渲染整块摘要（含几个空占位节点），`version` 随后按属性
 * 把这些节点找回来填「已选版本」与「Release 发布时间」。属性名集中在这里共用，
 * 模板与查找不会各写一份字面量而悄悄失配；失配时由 `version` 写一行日志提示。
 *
 * 注意 `src/index.scss` 里的同名选择器无法引用本模块（CSS 不能 import TS），
 * 改这里的属性名时要一并搜索样式文件
 */

export const REPO_SUMMARY_ATTRS = {
    /** 标题行末尾的「已选版本」外层（无版本时隐藏整块） */
    pickedVersionWrap: "data-jcip-picked-version-wrap",
    /** 上述外层里指向该 tag Release 页面的链接 */
    pickedVersionLink: "data-jcip-picked-version-link",
    /** 元信息区里显示所选版本发布时间的胶囊 */
    releasePublishedChip: "data-jcip-release-published-chip",
} as const;
