/**
 * 预览用的静态服务器
 *
 * 有两个必须走 HTTP 而不能用 `file://` 的理由：
 * - 预览页的脚本是普通 `<script>`，但页面会 `fetch("/__results")` 回传结果，`file://` 下会被 CORS 拒
 * - 缩略图/头像这类资源需要真实的 200 / 404，才能验证「加载成功与失败两条分支」
 *
 * `POST /__results` 是这套脚手架的关键：断言跑在浏览器里，结果必须回到 Node 进程，
 * 否则终端拿不到成败，只能靠人肉看页面
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
};

export function startPreviewServer({ root, port = 0 }) {
    const rootDir = path.resolve(root);
    let settleResults;
    const results = new Promise((resolve) => {
        settleResults = resolve;
    });

    const server = http.createServer((request, response) => {
        if (request.method === "POST" && request.url === "/__results") {
            let body = "";
            request.on("data", (chunk) => {
                body += chunk;
            });
            request.on("end", () => {
                response.writeHead(204).end();
                try {
                    settleResults(JSON.parse(body));
                } catch (error) {
                    settleResults({ parseError: String(error), raw: body });
                }
            });
            return;
        }

        const url = new URL(request.url, "http://127.0.0.1");
        const relPath = url.pathname === "/" ? "/index.html" : url.pathname;
        // 只允许读取 root 内的文件：拒绝越出目录的路径（如 /../package.json）
        const filePath = path.join(rootDir, decodeURIComponent(relPath));
        if (!filePath.startsWith(rootDir + path.sep) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
            return;
        }
        response.writeHead(200, {
            "content-type": CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream",
        });
        response.end(fs.readFileSync(filePath));
    });

    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
            const actualPort = server.address().port;
            resolve({
                url: `http://127.0.0.1:${actualPort}/`,
                port: actualPort,
                results,
                close: () => server.close(),
            });
        });
    });
}
