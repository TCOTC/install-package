/**
 * 「中断安装 / 安装进度」按钮的渲染
 *
 * 安装期间它是唯一可见且可点击的按钮。进度以半透明 on-primary 叠在按钮自身主色底上，
 * 而不是换成透明进度条：这样按钮文案始终保持 on-primary 对比度，也不会与被禁用按钮的变暗叠加。
 * 百分比放在标签内部的绝对定位层里：它不参与排版，标签文本始终居中在原本的位置，不随百分比位数变化而移动
 */

/** 进度按钮各阶段的文案 */
export interface InstallProgressButtonLabels {
    /** 空闲：可点击，点击开始安装 */
    idle: string;
    /** 下载中：可点击，点击中断安装 */
    abort: string;
    /** 本地安装中：不可点击，仅表示进行中 */
    installing: string;
}

const LABEL_CLASS = "jcip-abort__label";
const TEXT_CLASS = "jcip-abort__text";
const PERCENT_CLASS = "jcip-abort__percent";

/** 进度按钮的内层结构；标签另用一层包裹，便于按阶段改写而不会连带清掉百分比层 */
function buildInner(label: string): HTMLElement {
    const labelEl = document.createElement("span");
    labelEl.className = LABEL_CLASS;
    const textEl = document.createElement("span");
    textEl.className = TEXT_CLASS;
    textEl.textContent = label;
    const percentEl = document.createElement("span");
    percentEl.className = PERCENT_CLASS;
    labelEl.append(textEl, percentEl);
    return labelEl;
}

/**
 * 一枚（或一组文案一致的）进度按钮；同一时刻的状态由最后一次调用决定
 */
export class InstallProgressButton {
    private readonly buttons: HTMLButtonElement[];

    constructor(buttons: HTMLButtonElement[], private readonly labels: InstallProgressButtonLabels) {
        this.buttons = buttons;
        for (const button of buttons) {
            button.classList.add("jcip-abort");
            if (button.querySelector("." + LABEL_CLASS) === null) {
                button.replaceChildren(buildInner(labels.idle));
            }
        }
        this.reset();
    }

    /** 回到可点击的空闲态 */
    reset(): void {
        for (const button of this.buttons) {
            button.disabled = false;
            button.classList.remove("jcip-abort--download", "jcip-abort--indeterminate");
            button.style.removeProperty("--jcip-abort-progress");
        }
        this.setPercentText("");
        this.setLabelText(this.labels.idle);
    }

    /** 下载阶段：按钮保持可点，写入进度填充与标签右侧百分比（0 到 1） */
    renderDownload(ratio: number): void {
        const percent = Math.floor(Math.max(0, Math.min(ratio, 1)) * 100);
        for (const button of this.buttons) {
            button.disabled = false;
            button.classList.remove("jcip-abort--indeterminate");
            button.classList.add("jcip-abort--download");
            button.style.setProperty("--jcip-abort-progress", `${percent}%`);
        }
        this.setPercentText(`${percent}%`);
        this.setLabelText(this.labels.abort);
    }

    /**
     * 本地安装阶段：上传与安装由内核同步完成，客户端 abort 不会真的停下它，
     * 因此置为不可点并把文案改为「正在安装」，避免按钮给出停不下来的假承诺；
     * 字节进度不可得，改用滚动的斜条纹表示进行中
     */
    renderIndeterminate(): void {
        for (const button of this.buttons) {
            button.disabled = true;
            button.classList.remove("jcip-abort--download");
            button.classList.add("jcip-abort--indeterminate");
            button.style.removeProperty("--jcip-abort-progress");
        }
        this.setPercentText("");
        this.setLabelText(this.labels.installing);
    }

    /** 只改写标签文案层；标签宽度变化不会带动右侧百分比层 */
    private setLabelText(text: string): void {
        for (const button of this.buttons) {
            const textEl = button.querySelector("." + TEXT_CLASS);
            if (textEl !== null) {
                textEl.textContent = text;
            }
        }
    }

    /** 只改写标签右侧的百分比层；标签文本不变，因此标签位置固定 */
    private setPercentText(text: string): void {
        for (const button of this.buttons) {
            const percentEl = button.querySelector("." + PERCENT_CLASS);
            if (percentEl !== null) {
                percentEl.textContent = text;
            }
        }
    }
}
