/**
 * 安装面板里「与当前 URL 仓库相同的本地集市包」
 *
 * 面板据此显示「卸载」「打开本地详情页」「打开包目录」与「打开插件存储目录」这几个键：
 * 目标按仓库键匹配（同一仓库可能对应多个包），检测结果与「插件存储目录是否存在」都带缓存，
 * 安装或卸载成功后再失效。
 *
 * 与界面的耦合只通过 `onChanged` 回调：模块只管数据与内核请求，显隐由面板自己投影
 */

import { i18n } from "../infra/i18n";
import { directoryPresence } from "../infra/kernelClient";
import type { Logger } from "../infra/logger";
import { normalizeRepoKey } from "../infra/repoKey";
import { findInstalledByRepo, listInstalledPackages, type InstalledPackage } from "../install/installedPackages";
import { uninstallInstalledPackages } from "../install/uninstall";

/** 插件的存储目录（插件通过 `saveData` 等接口写入的私有目录） */
export function petalDirPath(name: string): string {
    return `data/storage/petal/${name}`;
}

export class PanelUninstallTargets {
    /** 匹配到的本地集市包；`0` 号是各操作键针对的对象 */
    private targets: InstalledPackage[] = [];
    /** 最近一次 `setRepoKey` 的仓库键；卸载后据此重新检测 */
    private repoKey = "";
    /** 仓库键到检测结果的缓存，安装或卸载成功后失效 */
    private readonly cache = new Map<string, InstalledPackage[]>();
    /** 插件存储目录是否存在；目录由插件自己在运行时创建，故需问内核 */
    private readonly petalDirCache = new Map<string, boolean>();
    /** 在途的目录检查：同一路径只发一次请求（状态未知时不写缓存，可能被反复问） */
    private readonly petalDirPending = new Set<string>();
    /** 检测序号：URL 变化或面板关闭后作废在途回调 */
    private detectSeq = 0;
    /** 目录检查序号：新的一次检查或面板关闭后作废在途回调 */
    private petalDirSeq = 0;
    private destroyed = false;

    constructor(
        /** 插件自身包名：卸载目标里必须把插件自身剔除 */
        private readonly pluginName: string,
        private readonly log: Logger,
        /** 目标集合或目录可见性变化时回调，面板据此重投影操作键 */
        private readonly onChanged: () => void,
    ) {}

    /** 各操作键针对的对象；没有匹配到的包时为 undefined */
    get first(): InstalledPackage | undefined {
        return this.targets[0];
    }

    /**
     * URL 解析落定后换上新的仓库键并重新检测
     *
     * 空键表示当前输入无效，无需请求内核，直接清空
     */
    setRepoKey(repoKey: string): void {
        this.repoKey = normalizeRepoKey(repoKey);
        if (this.repoKey === "") {
            this.detectSeq++;
            this.targets = [];
            this.onChanged();
            return;
        }
        void this.detect(this.repoKey);
    }

    /**
     * 按当前仓库键检测本地包
     *
     * 同一仓库可能对应多个包（实测有插件与主题的元数据里写着同一个仓库地址），因此结果是列表；
     * 检测失败时静默降级（清空），不阻塞安装；只命中插件自身时也会剔光
     */
    private async detect(repoKey: string): Promise<void> {
        const seq = ++this.detectSeq;
        const cached = this.cache.get(repoKey);
        if (cached !== undefined) {
            this.targets = cached;
            this.onChanged();
            return;
        }
        const result = await listInstalledPackages(this.log);
        if (this.destroyed || seq !== this.detectSeq) {
            return;
        }
        if (result === null) {
            this.targets = [];
            this.onChanged();
            return;
        }
        const matched = findInstalledByRepo(result.packages, repoKey);
        const targets = matched.filter((pkg) => !this.isOwnPlugin(pkg));
        if (targets.length === 0 && matched.length > 0) {
            this.log.info(i18n.uninstallSelfExcluded);
        }
        this.cache.set(repoKey, targets);
        this.targets = targets;
        this.onChanged();
    }

    /** 目标是否为插件自身（按包名）；自身不能卸载 */
    private isOwnPlugin(pkg: InstalledPackage): boolean {
        return pkg.type === "plugin" && pkg.name === this.pluginName;
    }

    /**
     * 是否显示「打开插件存储目录」
     *
     * 目录由插件自己在运行时写入（安装集市包不会建它），要用内核接口确认；结果按路径缓存。
     * 未知时先按「不存在」处理并触发一次检查，检查回来后重投影。
     * 内核不可达时状态未知，既不写缓存也不改界面，下一次投影会再问一遍，
     * 避免把一次网络抖动记成「目录不存在」
     */
    hasPetalDir(): boolean {
        const target = this.targets[0];
        if (target === undefined || target.type !== "plugin") {
            return false;
        }
        const path = petalDirPath(target.name);
        const cached = this.petalDirCache.get(path);
        if (cached !== undefined) {
            return cached;
        }
        void this.checkPetalDir(path);
        return false;
    }

    /** 询问内核目录是否存在；只有最后一次检查能重投影，面板已关闭则丢弃结果 */
    private async checkPetalDir(path: string): Promise<void> {
        if (this.petalDirPending.has(path)) {
            return;
        }
        this.petalDirPending.add(path);
        const seq = ++this.petalDirSeq;
        const presence = await directoryPresence(path);
        this.petalDirPending.delete(path);
        if (presence === "unknown") {
            return;
        }
        this.petalDirCache.set(path, presence === "exists");
        if (this.destroyed || seq !== this.petalDirSeq) {
            return;
        }
        this.onChanged();
    }

    /** 确认后卸载全部匹配到的包，然后重新检测 */
    async uninstall(): Promise<void> {
        // 检测结果可能已过期，执行前再剔一次插件自身
        const targets = this.targets.filter((pkg) => !this.isOwnPlugin(pkg));
        if (targets.length === 0) {
            return;
        }
        const allOk = await uninstallInstalledPackages(targets, this.log);
        if (allOk) {
            this.cache.clear();
        }
        if (this.destroyed || this.repoKey === "") {
            return;
        }
        await this.detect(this.repoKey);
    }

    /** 安装成功：包集合与存储目录的存在性都可能变了，清缓存并重检 */
    invalidateAfterInstall(): void {
        this.cache.clear();
        this.petalDirCache.clear();
        if (this.repoKey !== "") {
            void this.detect(this.repoKey);
        }
    }

    /** 面板关闭：在途回调凭序号与 `destroyed` 自行作废 */
    destroy(): void {
        this.destroyed = true;
        this.detectSeq++;
        this.petalDirSeq++;
    }
}
