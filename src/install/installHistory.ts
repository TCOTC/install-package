/**
 * 安装历史记录
 *
 * 每次安装成功后记下「仓库 + 版本」，安装页的 URL 输入框右侧按钮据此列出历史，
 * 选中一项即可把仓库 URL 与版本号填回表单。
 *
 * 记录通过插件私有存储持久化，因此本模块只依赖注入的存储适配器，不 import `siyuan`：
 * 解析与并入都是纯函数，可直接在 Node 下测试
 */

/** 一条安装历史 */
export interface InstallHistoryEntry {
    /** 仓库属主，保留安装当时的写法 */
    owner: string;
    /** 仓库名 */
    repo: string;
    /** 安装时选中的 Git Tag */
    version: string;
}

/** 历史条数上限：超出后丢弃最旧的记录，避免无限增长 */
export const INSTALL_HISTORY_LIMIT = 20;

/** 历史记录在插件私有目录里的文件名 */
export const INSTALL_HISTORY_STORAGE_NAME = "install-history";

/** 历史记录的存储适配器；由插件入口注入（`plugin.loadData` / `plugin.saveData` / `plugin.removeData`） */
export interface InstallHistoryStorage {
    load(): Promise<unknown>;
    save(entries: readonly InstallHistoryEntry[]): Promise<unknown>;
    /** 删除存储文件：记录清空时调用，不留下一个空文件 */
    remove(): Promise<unknown>;
}

let storage: InstallHistoryStorage | null = null;
/** 最新的记录在前 */
let entries: InstallHistoryEntry[] = [];
let loading: Promise<void> | null = null;

/** 插件入口在 onload 时注入存储适配器，并清空上一个实例的内存状态 */
export function initInstallHistory(adapter: InstallHistoryStorage): void {
    storage = adapter;
    entries = [];
    loading = null;
}

/** 同一仓库同一版本的去重键；仓库名大小写无关 */
function entryKey(owner: string, repo: string, version: string): string {
    return `${owner}/${repo}@${version}`.toLowerCase();
}

/** 单条记录的形态校验；字段缺失或为空白时按无效处理 */
function readInstallHistoryEntry(raw: unknown): InstallHistoryEntry | null {
    if (raw === null || typeof raw !== "object") {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const { owner, repo, version } = record;
    if (typeof owner !== "string" || typeof repo !== "string" || typeof version !== "string") {
        return null;
    }
    const entry = { owner: owner.trim(), repo: repo.trim(), version: version.trim() };
    return entry.owner !== "" && entry.repo !== "" && entry.version !== "" ? entry : null;
}

/**
 * 从存储内容解析历史记录
 *
 * 存储名没有扩展名，内核按文本返回，因此这里同时接受「JSON 文本」与「已解析的数组」两种形态；
 * 内容异常时按「无记录」处理，只影响列表展示
 */
export function parseInstallHistory(raw: unknown): InstallHistoryEntry[] {
    let value = raw;
    if (typeof value === "string") {
        const text = value.trim();
        if (text === "") {
            return [];
        }
        try {
            value = JSON.parse(text);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(value)) {
        return [];
    }
    const out: InstallHistoryEntry[] = [];
    for (const item of value) {
        const entry = readInstallHistoryEntry(item);
        if (entry !== null) {
            out.push(entry);
        }
    }
    return out;
}

/**
 * 把一条记录并入历史：同一仓库同一版本只保留一条并置顶，超出上限丢弃最旧的记录
 *
 * 纯函数，返回新数组、不修改入参
 */
export function mergeInstallHistoryEntry(
    list: readonly InstallHistoryEntry[],
    entry: InstallHistoryEntry,
    limit: number = INSTALL_HISTORY_LIMIT,
): InstallHistoryEntry[] {
    const key = entryKey(entry.owner, entry.repo, entry.version);
    const rest = list.filter((item) => entryKey(item.owner, item.repo, item.version) !== key);
    return [entry, ...rest].slice(0, Math.max(0, limit));
}

/** 载入历史记录；同一插件实例只读一次，读取失败按无记录处理 */
export function ensureInstallHistoryLoaded(): Promise<void> {
    loading ??= (async (): Promise<void> => {
        if (storage === null) {
            return;
        }
        try {
            entries = parseInstallHistory(await storage.load());
        } catch {
            entries = [];
        }
    })();
    return loading;
}

/** 当前历史记录（最新的在前）；读取前应先 `ensureInstallHistoryLoaded` */
export function listInstallHistory(): readonly InstallHistoryEntry[] {
    return entries;
}

/**
 * 写入记录：没有记录时删除存储文件
 *
 * 写入失败只影响下次打开列表时的内容，不打断调用流程，因此只吞掉异常
 */
async function persistInstallHistory(next: InstallHistoryEntry[]): Promise<void> {
    entries = next;
    try {
        if (next.length === 0) {
            await storage?.remove();
        } else {
            await storage?.save(next);
        }
    } catch {
        // 忽略写入失败
    }
}

/**
 * 记下一条成功的安装
 *
 * 记录写入失败只影响下次打开列表时的内容，不打断安装流程
 */
export async function recordInstallHistory(owner: string, repo: string, version: string): Promise<void> {
    await ensureInstallHistoryLoaded();
    await persistInstallHistory(mergeInstallHistoryEntry(entries, { owner, repo, version }));
}

/**
 * 删除一条历史记录
 *
 * 删掉最后一条时一并删除存储文件；记录不存在时什么也不做（不写盘、不删文件）
 */
export async function removeInstallHistoryEntry(owner: string, repo: string, version: string): Promise<void> {
    await ensureInstallHistoryLoaded();
    const key = entryKey(owner, repo, version);
    const next = entries.filter((item) => entryKey(item.owner, item.repo, item.version) !== key);
    if (next.length === entries.length) {
        return;
    }
    await persistInstallHistory(next);
}

/** 清空全部历史记录并删除存储文件；本来就没有记录时什么也不做 */
export async function clearInstallHistory(): Promise<void> {
    await ensureInstallHistoryLoaded();
    if (entries.length === 0) {
        return;
    }
    await persistInstallHistory([]);
}

/** 由历史记录还原仓库 URL（用于填回 URL 输入框） */
export function installHistoryUrl(entry: InstallHistoryEntry): string {
    return `https://github.com/${entry.owner}/${entry.repo}`;
}
