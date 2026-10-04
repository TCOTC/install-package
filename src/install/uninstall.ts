/**
 * 卸载本地集市包
 *
 * 五种类型走同一套流程，只是接口不同：图标与主题正在使用时无需先切回默认，
 * 内核卸载后会刷新外观配置并把不再存在的主题、图标切回内置默认值。
 */

import { Dialog, getFrontend } from "siyuan";
import { i18n } from "../infra/i18n";
import { fetchSyncPost } from "../infra/kernelClient";
import type { PackageType } from "./install";
import { kernelPackageTypeLabel, type InstalledPackage } from "./installedPackages";
import type { Logger } from "../ui/logger";

/** 各类型的卸载接口；只有插件与主题按前端过滤 */
const UNINSTALL_API: Record<PackageType, { url: string; withFrontend: boolean }> = {
    plugin: { url: "/api/bazaar/uninstallBazaarPlugin", withFrontend: true },
    theme: { url: "/api/bazaar/uninstallBazaarTheme", withFrontend: true },
    icon: { url: "/api/bazaar/uninstallBazaarIcon", withFrontend: false },
    widget: { url: "/api/bazaar/uninstallBazaarWidget", withFrontend: false },
    template: { url: "/api/bazaar/uninstallBazaarTemplate", withFrontend: false },
};

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** 卸载单个已安装包；失败时写一行日志并返回 false */
export async function uninstallInstalledPackage(pkg: InstalledPackage, log: Logger): Promise<boolean> {
    const api = UNINSTALL_API[pkg.type];
    const response = await fetchSyncPost(
        api.url,
        api.withFrontend ? { packageName: pkg.name, frontend: getFrontend() } : { packageName: pkg.name },
    );
    if (response.code !== 0) {
        log.warn(i18n.uninstallFailed, `${pkg.name}: ${response.msg}`);
        return false;
    }
    log.info(
        i18n.uninstallDone
            .replace("{packageType}", kernelPackageTypeLabel(pkg.kernelType))
            .replace("{packageName}", pkg.name),
    );
    return true;
}

/**
 * 卸载确认框
 *
 * 只命中一个包时直接把包名写进问句，不列清单；命中多个时必须把实际会被卸载的包名摆出来，
 * 因为匹配是按仓库地址得出来的，一个仓库可能对应好几个包
 */
function confirmUninstallPackages(targets: InstalledPackage[]): Promise<boolean> {
    const inUseHint = targets.some((pkg) => pkg.current) ? `<p class="b3-label__text">${i18n.uninstallConfirmInUseHint}</p>` : "";
    let body: string;
    if (targets.length === 1) {
        const pkg = targets[0];
        const identity = `<strong>${escapeHtml(pkg.displayName)}</strong>${pkg.displayName === pkg.name ? "" : ` <strong>(${escapeHtml(pkg.name)})</strong>`}`;
        body = `<div class="b3-label__text">${i18n.uninstallConfirmSingle.replace("{identity}", identity)}</div>`;
    } else {
        const items = targets
            .map((pkg) => `<li><span class="jcip-uninstall-list__type">${escapeHtml(kernelPackageTypeLabel(pkg.kernelType))}</span>${escapeHtml(pkg.name)} <span class="jcip-uninstall-list__version">${escapeHtml(pkg.version)}</span></li>`)
            .join("");
        body = `<div class="b3-label__text">${i18n.uninstallConfirmContent}</div>
                    <ul class="jcip-uninstall-list">${items}</ul>`;
    }
    return new Promise((resolve) => {
        let result = false;
        const dialog = new Dialog({
            title: i18n.uninstallConfirmTitle,
            width: window.siyuan.mobile ? "92vw" : "480px",
            content:
                `<div class="b3-dialog__content">
                    ${body}
                    ${inUseHint}
                </div>
                <div class="b3-dialog__action">
                    <button data-type="cancel" class="b3-button b3-button--cancel">${i18n.cancel}</button><div class="fn__space"></div>
                    <button data-type="confirm" class="b3-button b3-button--text">${i18n.confirm}</button>
                </div>`,
            destroyCallback: () => {
                resolve(result);
            },
        });
        dialog.element.querySelector("button[data-type='cancel']")?.addEventListener("click", () => {
            dialog.destroy();
        });
        dialog.element.querySelector("button[data-type='confirm']")?.addEventListener("click", () => {
            result = true;
            dialog.destroy();
        });
    });
}

/**
 * 确认后逐个卸载；任一失败不影响其余目标，返回是否全部成功
 */
export async function uninstallInstalledPackages(targets: InstalledPackage[], log: Logger): Promise<boolean> {
    if (targets.length === 0) {
        return false;
    }
    if (!(await confirmUninstallPackages(targets))) {
        return false;
    }
    let allOk = true;
    for (const pkg of targets) {
        if (!(await uninstallInstalledPackage(pkg, log))) {
            allOk = false;
        }
    }
    return allOk;
}
