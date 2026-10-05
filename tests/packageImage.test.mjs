/**
 * `infra/packageImage.ts` 的单元测试
 *
 * 断言的核心是**顺序**：PNG 必须排在最前（集市的传统文件名 `icon.png` / `preview.png`），
 * 否则每个仓库都会先多发几个必然 404 的请求
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PACKAGE_IMAGE_EXTENSIONS, packageImageFileNames } from "../src/infra/packageImage.ts";

test("候选扩展名与内核接受的集市包图片类型一致", () => {
    assert.deepEqual(PACKAGE_IMAGE_EXTENSIONS, [".png", ".jpg", ".jpeg", ".webp", ".avif"]);
});

test("按扩展名顺序拼出候选文件名，PNG 在最前", () => {
    assert.deepEqual(packageImageFileNames("preview"), [
        "preview.png",
        "preview.jpg",
        "preview.jpeg",
        "preview.webp",
        "preview.avif",
    ]);
});

test("基名原样保留，不猜测目录或大小写", () => {
    assert.deepEqual(packageImageFileNames("Icon"), [
        "Icon.png",
        "Icon.jpg",
        "Icon.jpeg",
        "Icon.webp",
        "Icon.avif",
    ]);
});
