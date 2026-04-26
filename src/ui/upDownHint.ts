/**
 * 与思源 `app/src/util/upDownHint.ts` 中 `upDownHint` 行为一致（插件内无法引用内核路径）。
 */

export const isAbnormalItem = (currentHintElement: HTMLElement, className: string) => {
    return (
        currentHintElement &&
        (!currentHintElement.classList.contains(className) || currentHintElement.getBoundingClientRect().height === 0)
    );
};

export const upDownHint = (
    listElement: Element,
    event: KeyboardEvent,
    classActiveName = "b3-list-item--focus",
    defaultElement?: Element
) => {
    let currentHintElement = listElement.querySelector("." + classActiveName) as HTMLElement | null;
    if (!currentHintElement && defaultElement) {
        defaultElement.classList.add(classActiveName);
        (defaultElement as HTMLElement).scrollIntoView(true);
        return;
    }
    if (!currentHintElement) {
        return;
    }
    const className = classActiveName.split("--")[0];
    if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        currentHintElement.classList.remove(classActiveName);

        currentHintElement = currentHintElement.nextElementSibling as HTMLElement;
        while (isAbnormalItem(currentHintElement, className)) {
            currentHintElement = currentHintElement.nextElementSibling as HTMLElement;
        }

        if (!currentHintElement) {
            currentHintElement = listElement.children[0] as HTMLElement;
            while (isAbnormalItem(currentHintElement, className)) {
                currentHintElement = currentHintElement.nextElementSibling as HTMLElement;
            }
        }
        if (!currentHintElement) {
            return;
        }
        currentHintElement.classList.add(classActiveName);
        if (
            listElement.scrollTop < currentHintElement.offsetTop - listElement.clientHeight + currentHintElement.clientHeight ||
            listElement.scrollTop > currentHintElement.offsetTop
        ) {
            currentHintElement.scrollIntoView(listElement.scrollTop > currentHintElement.offsetTop);
        }
        return currentHintElement;
    }
    if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        currentHintElement.classList.remove(classActiveName);

        currentHintElement = currentHintElement.previousElementSibling as HTMLElement;
        while (isAbnormalItem(currentHintElement, className)) {
            currentHintElement = currentHintElement.previousElementSibling as HTMLElement;
        }

        if (!currentHintElement) {
            currentHintElement = listElement.children[listElement.children.length - 1] as HTMLElement;
            while (
                currentHintElement &&
                (currentHintElement.classList.contains("fn__none") || !currentHintElement.classList.contains(className))
            ) {
                currentHintElement = currentHintElement.previousElementSibling as HTMLElement;
            }
        }
        if (!currentHintElement) {
            return;
        }
        currentHintElement.classList.add(classActiveName);

        const overTop =
            listElement.scrollTop > currentHintElement.offsetTop - (currentHintElement.previousElementSibling?.clientHeight || 0);
        if (
            listElement.scrollTop < currentHintElement.offsetTop - listElement.clientHeight + currentHintElement.clientHeight ||
            overTop
        ) {
            currentHintElement.scrollIntoView(overTop);
        }
        return currentHintElement;
    }
    if (event.key === "Home") {
        event.preventDefault();
        event.stopPropagation();
        currentHintElement.classList.remove(classActiveName);
        currentHintElement = listElement.children[0] as HTMLElement;
        while (isAbnormalItem(currentHintElement, className)) {
            currentHintElement = currentHintElement.nextElementSibling as HTMLElement;
        }
        if (!currentHintElement) {
            return;
        }
        currentHintElement.classList.add(classActiveName);
        currentHintElement.scrollIntoView();
        return currentHintElement;
    }
    if (event.key === "End") {
        event.preventDefault();
        event.stopPropagation();
        currentHintElement.classList.remove(classActiveName);
        currentHintElement = listElement.children[listElement.children.length - 1] as HTMLElement;
        while (isAbnormalItem(currentHintElement, className)) {
            currentHintElement = currentHintElement.previousElementSibling as HTMLElement;
        }
        if (!currentHintElement) {
            return;
        }
        currentHintElement.classList.add(classActiveName);
        currentHintElement.scrollIntoView(false);
        return currentHintElement;
    }
};
