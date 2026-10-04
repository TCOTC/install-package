/**
 * 拼出预览用的样式表
 *
 * 插件样式直接编译 `src/index.scss`；如果给了思源源码目录，再把**已构建**的
 * `app/stage/build/desktop/base.*.css` 与两套主题变量拼到前面 —— 有了它们，
 * 预览页的控件外观与几何才和真实界面一致（`b3-button`、`b3-switch`、主题变量都来自那里）。
 *
 * 拿不到思源资源不算失败：插件样式自成一套，只是颜色会走 CSS 变量缺省值、几何会失真，
 * 所以只提示「外观不可信」，把是否继续交给调用方判断。
 *
 * 注意 `app/stage/build/` 的文件名带内容哈希，每次思源重新构建都会变，因此这里按通配找，
 * 不要写死文件名
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pluginDir } from "./harness.mjs";

const require = createRequire(new URL("../../../package.json", import.meta.url));

// 预览主题固定为「亮色 + 用选择器包起来的暗色」，与思源前端同一套变量名
const THEMES = [
    { name: "daylight", mode: "light" },
    { name: "midnight", mode: "dark" },
];

function findBaseCss(siyuanDir) {
    const buildDir = path.join(siyuanDir, "app", "stage", "build", "desktop");
    if (!fs.existsSync(buildDir)) {
        return null;
    }
    const name = fs.readdirSync(buildDir).find((item) => /^base\..+\.css$/.test(item));
    return name ? path.join(buildDir, name) : null;
}

/**
 * @param outFile 产物路径
 * @param siyuanDir 思源仓库根目录；给了但没有可用产物时 return 里会带 reason
 */
export function assemblePreviewCss({ outFile, siyuanDir }) {
    const sass = require("sass");
    const pluginCss = sass.compile(path.join(pluginDir, "src/index.scss")).css;

    const parts = [];
    let reason = siyuanDir ? "" : "未提供思源源码目录";
    if (siyuanDir) {
        const baseCss = findBaseCss(siyuanDir);
        if (!baseCss) {
            reason = `在 ${siyuanDir} 下找不到 app/stage/build/desktop/base.*.css（思源前端需要先构建过）`;
        } else {
            parts.push(fs.readFileSync(baseCss, "utf8"));
            for (const theme of THEMES) {
                const themeFile = path.join(siyuanDir, "app", "appearance", "themes", theme.name, "theme.css");
                if (!fs.existsSync(themeFile)) {
                    continue;
                }
                const css = fs.readFileSync(themeFile, "utf8");
                // 暗色主题要挂到预览页的 <html data-mode="dark"> 上，否则两套 :root 会互相覆盖
                parts.push(theme.mode === "dark" ? css.replace(/:root/g, '[data-mode="dark"]') : css);
            }
            reason = "";
        }
    }
    parts.push(pluginCss);

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, parts.join("\n"), "utf8");
    return { hasSiYuanCss: reason === "", reason, bytes: parts.reduce((sum, item) => sum + item.length, 0) };
}
