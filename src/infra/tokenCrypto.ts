/**
 * 基于“设备特征 + KDF + AES-GCM”加密 Token，避免明文落盘。
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const CURRENT_VERSION = "v1";
const KDF_ITERATIONS = 500000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const DEVICE_HASH_LEN = 20;

/**
 * 将字节数组编码为 Base64 字符串。
 */
function bytesToBase64(bytes: Uint8Array): string {
    let s = "";
    // 先逐字节转为二进制字符串，供 btoa 编码。
    for (let i = 0; i < bytes.length; i++) {
        s += String.fromCharCode(bytes[i]);
    }
    return btoa(s);
}

/**
 * 将字节数组编码为 URL 安全的 Base64 字符串。
 */
function bytesToBase64Url(bytes: Uint8Array): string {
    // Base64 URL 安全化：`+` -> `-`，`/` -> `_`，并去掉尾部 `=` 号
    return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * 将 Base64 字符串解码为字节数组；解码失败时返回 null。
 */
function base64ToBytes(b64: string): Uint8Array | null {
    try {
        // 先还原为二进制字符串，再逐字符转回字节值。
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) {
            out[i] = bin.charCodeAt(i);
        }
        return out;
    } catch {
        // 非法 Base64 输入统一返回 null，避免抛出异常中断流程。
        return null;
    }
}

/**
 * 将 URL 安全 Base64 字符串解码为字节数组。
 */
function base64UrlToBytes(b64url: string): Uint8Array | null {
    // 先将 URL 安全字符映射回标准 Base64 字符集。
    const padded = b64url.replace(/-/g, "+").replace(/_/g, "/");
    // 补齐到 4 的倍数，满足 Base64 解码要求。
    const pad = padded.length % 4;
    const normalized = pad === 0 ? padded : padded + "=".repeat(4 - pad);
    return base64ToBytes(normalized);
}

/**
 * 将字节数组转换为十六进制字符串。
 */
function bytesToHex(bytes: Uint8Array): string {
    let out = "";
    // 每个字节固定输出 2 位十六进制，不足前补 0。
    for (let i = 0; i < bytes.length; i++) {
        out += bytes[i].toString(16).padStart(2, "0");
    }
    return out;
}

/**
 * 将 Uint8Array 裁剪为其有效区间对应的 ArrayBuffer。
 */
function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * 对输入 seed 计算 SHA-256 摘要。
 */
async function digestFromSeed(seed: string): Promise<Uint8Array> {
    // 统一以 UTF-8 编码输入，再交给 Web Crypto 计算摘要。
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(seed));
    return new Uint8Array(digest);
}

/**
 * 收集当前工作空间运行环境的相对稳定特征，拼接为密钥派生种子。
 */
function getWorkspaceSeed(): string {
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    const navEx = nav as Navigator & { deviceMemory?: number };
    const tz = (() => {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
        } catch {
            return "";
        }
    })();
    const platform = nav?.platform ?? "";
    const language = nav?.language ?? "";
    const memory = String(navEx?.deviceMemory ?? "");
    const cores = String(nav?.hardwareConcurrency ?? "");
    const workspaceDir = window.siyuan.config.system.workspaceDir ?? "";
    const deviceId = window.siyuan.config.system.id ?? "";
    const deviceName = window.siyuan.config.system.name ?? "";
    const devicePlatform = window.siyuan.config.system.osPlatform ?? "";
    return [workspaceDir, platform, language, tz, memory, cores, deviceId, deviceName, devicePlatform].join("|");
}

/**
 * 基于设备种子与随机 salt 通过 PBKDF2 派生 AES-GCM 密钥。
 */
async function deriveAesKey(deviceSeed: string, salt: Uint8Array): Promise<CryptoKey> {
    // 第一步：导入原始种子，作为 PBKDF2 的输入材料。
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(deviceSeed),
        "PBKDF2",
        false,
        ["deriveKey"]
    );
    // 第二步：使用高迭代次数拉伸密钥，降低暴力猜解风险。
    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: bytesToArrayBuffer(salt),
            iterations: KDF_ITERATIONS,
            hash: "SHA-256",
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

/**
 * 生成指定长度的密码学安全随机字节。
 */
function randomBytes(size: number): Uint8Array {
    const out = new Uint8Array(size);
    crypto.getRandomValues(out);
    return out;
}

/**
 * 基于设备特征派生稳定文件名，用于本地 Token 密文存储。
 */
export async function deriveTokenVaultFileName(): Promise<string> {
    // 增加固定前缀，避免与其它用途的摘要命名冲突。
    const digest = await digestFromSeed(`token-vault:${getWorkspaceSeed()}`);
    // 截断摘要长度以平衡可读性与冲突概率。
    const short = bytesToHex(digest).slice(0, DEVICE_HASH_LEN);
    return `token_${short}.dat`;
}

/**
 * 加密明文 Token，输出可持久化的版本化载荷字符串。
 */
export async function encryptToken(plain: string): Promise<string> {
    // 明确拒绝空输入，避免生成无意义密文。
    if (!plain) {
        throw new Error("empty token");
    }
    // 每次加密都生成新的 salt 和 iv，保证同样明文也不会产出相同密文。
    const seed = getWorkspaceSeed();
    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(IV_BYTES);
    const key = await deriveAesKey(seed, salt);
    // 使用 AES-GCM 执行认证加密，输出包含认证标签的密文。
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: bytesToArrayBuffer(iv) },
        key,
        encoder.encode(plain)
    );
    const cipher = new Uint8Array(encrypted);
    // 统一为 CURRENT_VERSION.salt.iv.cipher 格式，便于后续版本升级时做兼容转换。
    return `${CURRENT_VERSION}.${bytesToBase64Url(salt)}.${bytesToBase64Url(iv)}.${bytesToBase64Url(cipher)}`;
}

/**
 * 解密版本化载荷
 * 
 * @param payload 版本化载荷字符串
 * @returns 明文 Token 或 null（解密失败）
 */
export async function decryptToken(payload: string): Promise<string | null> {
    // 空载荷直接视为无可用数据。
    if (!payload) {
        return null;
    }
    // 先做格式校验，确保版本与段数正确。
    const parts = payload.split(".");
    if (parts.length !== 4 || parts[0] !== CURRENT_VERSION) {
        return null;
    }
    // 依次解析 salt、iv、cipher，任一失败都视为无效密文。
    const salt = base64UrlToBytes(parts[1]);
    const iv = base64UrlToBytes(parts[2]);
    const cipher = base64UrlToBytes(parts[3]);
    if (!salt || !iv || !cipher) {
        return null;
    }
    try {
        // 使用当前设备特征重新派生密钥，确保仅同一环境可解密。
        const seed = getWorkspaceSeed();
        const key = await deriveAesKey(seed, salt);
        const plain = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: bytesToArrayBuffer(iv) },
            key,
            bytesToArrayBuffer(cipher)
        );
        return decoder.decode(new Uint8Array(plain));
    } catch {
        // 设备特征变化、密文损坏或认证失败都会进入该分支。
        return null;
    }
}
