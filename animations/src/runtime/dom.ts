type Child = Node | string | null | undefined | false;
type Attributes = Record<string, string | number | undefined> & {
	class?: string;
	style?: string;
};

/**
 * Creates an element. `tag` may carry classes, as in `div.card.wide`.
 * Strings are added as text; use `html` for markup.
 */
export function h(
	tag: string,
	attributes: Attributes | Child = {},
	...children: Child[]
): HTMLElement {
	if (
		attributes instanceof Node ||
		typeof attributes !== "object" ||
		attributes === null
	) {
		children.unshift(attributes as Child);
		attributes = {};
	}

	const [name, ...classes] = tag.split(".");
	const element = document.createElement(name || "div");
	if (classes.length) element.className = classes.join(" ");

	for (const [key, value] of Object.entries(attributes)) {
		if (value === undefined) continue;
		if (key === "class") element.classList.add(...String(value).split(" "));
		else element.setAttribute(key, String(value));
	}

	for (const child of children) {
		if (child === null || child === undefined || child === false) continue;
		element.append(child);
	}
	return element;
}

/** Parses trusted markup into nodes. */
export function html(markup: string): DocumentFragment {
	const template = document.createElement("template");
	template.innerHTML = markup;
	return template.content;
}

/** Finds a required descendant. */
export function $(root: ParentNode, selector: string): HTMLElement {
	const element = root.querySelector<HTMLElement>(selector);
	if (!element) throw new Error(`Nothing matches ${selector}`);
	return element;
}

/**
 * Where `element` sits inside `container`, from layout offsets, so scaling the
 * stage for a preview doesn't change the answer. `container` must be
 * positioned.
 */
export function offsetWithin(
	element: HTMLElement,
	container: HTMLElement,
): { x: number; y: number; width: number; height: number } {
	let x = 0;
	let y = 0;
	let node: HTMLElement | null = element;
	while (node && node !== container) {
		x += node.offsetLeft;
		y += node.offsetTop;
		node = node.offsetParent as HTMLElement | null;
	}
	if (node !== container) throw new Error("Not inside the container");
	return { x, y, width: element.offsetWidth, height: element.offsetHeight };
}
