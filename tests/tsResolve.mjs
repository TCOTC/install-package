/**
 * 测试用的模块解析钩子：把无扩展名的相对导入补成 `.ts`
 *
 * `src/` 里的源码按打包器（webpack / esbuild-loader）的习惯写无扩展名导入，而 Node 在 ESM 下
 * 不补扩展名，直接 `import` 会报 `ERR_MODULE_NOT_FOUND`。此前只有「自身没有任何运行时导入」
 * 的模块能被单元测试覆盖，这条钩子解除了该限制，测试文件可以照常写 `import "../src/x.ts"`。
 *
 * 由 `package.json` 的 `test` 脚本通过 `--import` 在测试文件加载前注册；只影响相对导入，
 * 裸模块名（`siyuan`、`node:test` 等）与已带扩展名的导入都原样交给 Node 处理
 */

import { registerHooks } from "node:module";

/** 依次尝试的补全候选，与 TypeScript / 打包器的解析顺序一致 */
const CANDIDATE_SUFFIXES = [".ts", ".tsx", "/index.ts"];

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
            for (const suffix of CANDIDATE_SUFFIXES) {
                try {
                    return nextResolve(specifier + suffix, context);
                } catch {
                    // 该候选不存在，继续尝试下一个
                }
            }
        }
        return nextResolve(specifier, context);
    },
});
