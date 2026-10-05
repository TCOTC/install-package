/**
 * 集市包版本比较（语义化版本 2.0.0）
 *
 * 元数据里的版本通常不带前缀（如 `0.4.6`），Release 的 tag 可能带 `v`（如 `v0.4.6`），
 * 比较前先去掉这个前缀；核心三段 `主.次.修订` 缺一不可（`1.0` 不是语义化版本），
 * 数字标识符不允许前导零。无法解析的版本返回 null，由调用方决定是否声明「有新版本」。
 *
 * 自我安装的最低版本校验复用这里的比较（见 `isVersionAtLeast`），两处对同一个 tag 的判定口径一致
 */

/** 预发布标识符：`0`、无前导零的数字，或至少含一个字母或连字符的字母数字串 */
const PRERELEASE_IDENTIFIER = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";

/** 语义化版本 2.0.0 的完整形态，另允许开头的 `v` 前缀（集市 tag 的常见写法） */
const SEMVER_PATTERN = new RegExp(
    "^[vV]?(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)"
    + `(?:-(${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*))?`
    + "(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$",
);

interface ParsedVersion {
    /** 核心三段：主版本、次版本、修订号 */
    numbers: [number, number, number];
    /** 预发布标识（如 `1.0.0-beta.1` 的 `beta.1`）；正式版为空数组 */
    prerelease: (number | string)[];
}

/** 解析 `[v]主.次.修订[-预发布][+构建]`；不符合语义化版本时返回 null */
function parseVersion(raw: string): ParsedVersion | null {
    const match = raw.trim().match(SEMVER_PATTERN);
    if (!match) {
        return null;
    }
    return {
        numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
        prerelease: (match[4] ?? "")
            .split(".")
            .filter((part) => part !== "")
            .map((part) => (/^\d+$/.test(part) ? Number(part) : part)),
    };
}

/**
 * 比较两个版本：`a > b` 返回 1，`a < b` 返回 -1，相等返回 0，无法解析返回 null
 *
 * 预发布版本低于同号正式版（`1.0.0-beta` < `1.0.0`），构建元数据（`+` 之后）不参与比较
 */
export function comparePackageVersions(a: string, b: string): number | null {
    const va = parseVersion(a);
    const vb = parseVersion(b);
    if (!va || !vb) {
        return null;
    }
    for (let i = 0; i < va.numbers.length; i++) {
        if (va.numbers[i] !== vb.numbers[i]) {
            return va.numbers[i] > vb.numbers[i] ? 1 : -1;
        }
    }
    const pa = va.prerelease;
    const pb = vb.prerelease;
    if (pa.length === 0 && pb.length === 0) {
        return 0;
    }
    if (pa.length === 0) {
        return 1;
    }
    if (pb.length === 0) {
        return -1;
    }
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i];
        const y = pb[i];
        if (x === undefined) {
            return -1;
        }
        if (y === undefined) {
            return 1;
        }
        if (x === y) {
            continue;
        }
        if (typeof x === "number" && typeof y === "number") {
            return x > y ? 1 : -1;
        }
        // 数字标识符低于字母标识符
        if (typeof x === "number") {
            return -1;
        }
        if (typeof y === "number") {
            return 1;
        }
        // 字母标识符按 ASCII 顺序比较（大小写敏感，故不先归一化为小写）
        return x > y ? 1 : -1;
    }
    return 0;
}

/**
 * `version` 是否达到 `minimum`
 *
 * 两者都按语义化版本解析，任一方无法解析（如 `1.0`、`nightly`）或低于最低版本时返回 false，
 * 与调用方「拿不准就不放行」的口径一致
 */
export function isVersionAtLeast(version: string, minimum: string): boolean {
    const compared = comparePackageVersions(version, minimum);
    return compared !== null && compared >= 0;
}
