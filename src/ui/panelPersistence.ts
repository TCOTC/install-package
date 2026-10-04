/**
 * 表单到 layout 的防抖持久化
 *
 * 安装面板的每个字段改动都要写回页签 layout，但 URL 输入框每敲一个字符就会改 `url`，
 * 逐次写会打断输入；这里用 Proxy 包住表单，字段真正变化后延迟写入，只保留最后一次。
 *
 * 与思源的耦合只有调用方传入的 `save`，因此本模块不依赖 siyuan，可直接测试
 */

export interface PersistedForm<T> {
    /** 被代理的表单；调用方直接读写字段即可 */
    data: T;
    /** 取消尚未落盘的一次写入（页签关闭时调用，避免回调打在已销毁的页面上） */
    cancel(): void;
    /** 立即落盘（若有待写入的改动）；仅测试与收尾使用 */
    flush(): void;
}

/**
 * 把表单包成「变化后延迟写 layout」的代理
 *
 * 只比较当前值本身：同一个值重复赋值不会触发写入（面板里多处回填表单，否则会被无谓地写盘）
 */
export function persistFormToLayout<T extends object>(
    plain: T,
    save: () => void,
    delayMs = 400,
): PersistedForm<T> {
    let timer: number | undefined;
    const flush = (): void => {
        if (timer === undefined) {
            return;
        }
        window.clearTimeout(timer);
        timer = undefined;
        save();
    };
    const data = new Proxy(plain, {
        set: (target, prop, value, receiver) => {
            const prev = Reflect.get(target, prop, receiver);
            if (!Reflect.set(target, prop, value, receiver)) {
                return false;
            }
            if (prev !== value) {
                window.clearTimeout(timer);
                timer = window.setTimeout(() => {
                    timer = undefined;
                    save();
                }, delayMs);
            }
            return true;
        },
    }) as T;
    return {
        data,
        cancel: () => {
            window.clearTimeout(timer);
            timer = undefined;
        },
        flush,
    };
}
