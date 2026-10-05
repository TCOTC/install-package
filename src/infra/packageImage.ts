/**
 * 集市包 icon / preview 的图片扩展名
 *
 * 顺序即「仓库默认分支根目录里依次尝试」的顺序，首个能加载的即为该缩略图；PNG 在最前是因为
 * 它是集市的历史文件名（清单未声明 `icon` / `preview` 字段时按 `icon.png` / `preview.png` 探测）。
 *
 * 与内核的判定保持一致：`kernel/bazaar/bazaar.go` 的 `isSupportedPackageImageName`、
 * 集市 `rules/images.go` 的 `imageMIMEByExtension` —— 这几类以外的图片不会被集市接受，
 * 因此不必去试 SVG、GIF 等其它扩展名
 */
export const PACKAGE_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".avif"];

/** 按 `PACKAGE_IMAGE_EXTENSIONS` 拼出候选文件名，例如 `preview` → `preview.png`、`preview.jpg`... */
export function packageImageFileNames(baseName: string): string[] {
    return PACKAGE_IMAGE_EXTENSIONS.map((extension) => baseName + extension);
}
