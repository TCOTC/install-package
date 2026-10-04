/**
 * 集市包版本比较
 *
 * 元数据里的版本通常不带前缀（如 `0.4.6`），Release 的 tag 可能带 `v`（如 `v0.4.6`），
 * 比较前先归一化；无法解析的版本返回 null，由调用方决定是否声明「有新版本」。
 */

interface ParsedVersion {
    /** 主版本号三段，缺省段按 0 处理 */
    numbers: number[];
    /** 预发布标识（如 `1.0.0-beta.1` 的 `beta.1`）；正式版为空数组 */
    prerelease: (number | string)[];
}

/** 解析 `[v]主.次.修订[-预发布][+构建]`；不符合该形态时返回 null */
function parseVersion(raw: string): ParsedVersion | null {
    const match = raw.trim().match(/^[vV]?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
    if (!match) {
        return null;
    }
    return {
        numbers: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
        prerelease: (match[4] ?? "")
            .split(".")
            .filter((part) => part !== "")
            .map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase())),
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
        return x > y ? 1 : -1;
    }
    return 0;
}
