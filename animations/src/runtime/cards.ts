import { h, offsetWithin } from "./dom.ts";
import { icon, type IconName, pointer } from "./icons.ts";
import { ease, type Timeline } from "./timeline.ts";

/** A panel with a header, placed absolutely on the stage. */
export function card(options: {
	icon?: IconName;
	title: string | Node;
	sub?: string;
	right?: Node;
	body?: Node[];
	class?: string;
}): HTMLElement {
	return h(
		`div.panel${options.class ? `.${options.class}` : ""}`,
		h(
			"div.card-head",
			options.icon ? icon(options.icon) : null,
			options.title,
			options.sub ? h("span.sub", options.sub) : null,
			h("span.grow"),
			options.right,
		),
		...(options.body ?? []),
	);
}

export function place(
	element: HTMLElement,
	box: { x: number; y: number; w: number; h?: number },
): HTMLElement {
	Object.assign(element.style, {
		left: `${box.x}px`,
		top: `${box.y}px`,
		width: `${box.w}px`,
		height: box.h === undefined ? "" : `${box.h}px`,
	});
	return element;
}

/** Several elements in one grid cell, to swap between with a timeline. */
export function swap(...states: Node[]): HTMLElement {
	const element = h("span.status-swap");
	states.forEach((state, index) => {
		const wrapper = state instanceof HTMLElement ? state : h("span", state);
		if (index > 0) wrapper.style.opacity = "0";
		element.append(wrapper);
	});
	return element;
}

/** A spinning icon. Spins for the whole scene, so show it only when needed. */
export function spinner(tl: Timeline, className = ""): SVGElement {
	const element = icon("spinner", `spin ${className}`);
	tl.loop(
		element,
		[{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
		0.8,
	);
	return element;
}

export interface Product {
	id: string;
	name: string;
	price: string;
	color: string;
	button?: string;
	/** Alternative button text, to swap to later. */
	button2?: string;
}

const PRODUCT_HEIGHT = 40;
const PRODUCT_GAP = 6;

/** A small shop in a browser window, with a pointer an agent can drive. */
export class ShopBrowser {
	readonly element: HTMLElement;
	readonly agent: HTMLElement;
	readonly nav = new Map<string, HTMLElement>();
	readonly products = new Map<string, HTMLElement>();
	readonly count: HTMLElement;
	readonly count2: HTMLElement;
	readonly select: HTMLElement;
	readonly selectValues: HTMLElement[];
	readonly menu: HTMLElement;
	readonly options: HTMLElement[];
	readonly content: HTMLElement;
	private readonly click: HTMLElement;

	constructor(options: {
		url: string;
		nav: string[];
		sort: string[];
		products: Product[];
	}) {
		this.count = h("span.cart-count", "0");
		this.count2 = h("span.cart-count", "1");
		this.count2.style.opacity = "0";

		const nav = h("div.shop-nav", h("span.brand", "Threads"));
		for (const item of options.nav) {
			const element = h("span.nav-item", item, h("i"));
			this.nav.set(item, element);
			nav.append(element);
		}
		nav.append(
			h("span.grow"),
			h("span.cart", icon("cart"), this.count, this.count2),
		);

		this.selectValues = options.sort.map((value, index) => {
			const element = h("span", value);
			if (index > 0) element.style.opacity = "0";
			return element;
		});
		this.options = options.sort.map((value) => h("div", value));
		this.menu = h("div.menu", ...this.options);
		this.menu.style.opacity = "0";
		this.select = h(
			"div.select",
			"Sort",
			h("span.value", ...this.selectValues),
			this.menu,
		);

		const list = h("div.products");
		list.style.height = `${options.products.length * (PRODUCT_HEIGHT + PRODUCT_GAP)}px`;
		options.products.forEach((product, index) => {
			const button = h("span.buy", h("span", product.button ?? "Add to cart"));
			if (product.button2) {
				const second = h("span", product.button2);
				second.style.opacity = "0";
				button.append(second);
			}
			const element = h(
				"div.product",
				h("span.thumb", { style: `background:${product.color}` }),
				h("span.name", product.name),
				h("span.price", product.price),
				button,
			);
			element.style.top = `${index * (PRODUCT_HEIGHT + PRODUCT_GAP)}px`;
			this.products.set(product.id, element);
			list.append(element);
		});

		this.click = h("span.click");
		this.agent = h(
			"div.agent",
			pointer(),
			h("span.chip.ai.tag", icon("sparkle"), "agent"),
			this.click,
		);

		this.content = h(
			"div.shop",
			nav,
			h("div.toolbar", h("span", "Shirts & more"), this.select),
			list,
		);
		this.element = h(
			"div.panel.browser",
			h(
				"div.bar",
				h("span.dots", h("i"), h("i"), h("i")),
				h("span.url", options.url),
			),
			this.content,
			this.agent,
		);
	}

	/** The centre of `target`, inside the browser window. */
	point(target: HTMLElement, dy = 0): { x: number; y: number } {
		const box = offsetWithin(target, this.element);
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 + dy };
	}

	/** Where a product's button will be once the product moves to `slot`. */
	buttonAt(id: string, slot: number): { x: number; y: number } {
		const product = this.product(id);
		const button = product.querySelector<HTMLElement>(".buy")!;
		const point = this.point(button);
		const from = Number.parseFloat(product.style.top);
		return {
			x: point.x,
			y: point.y + slot * (PRODUCT_HEIGHT + PRODUCT_GAP) - from,
		};
	}

	product(id: string): HTMLElement {
		const product = this.products.get(id);
		if (!product) throw new Error(`No product ${id}`);
		return product;
	}

	/** Moves products so `order` lists them from the top. */
	arrange(tl: Timeline, order: string[], at: number): number {
		let end = at;
		order.forEach((id, slot) => {
			const product = this.product(id);
			const offset =
				slot * (PRODUCT_HEIGHT + PRODUCT_GAP) -
				Number.parseFloat(product.style.top);
			end = tl.to(product, { transform: `translateY(${offset}px)` }, at, {
				dur: 0.5,
				ease: ease.inOut,
			});
		});
		return end;
	}

	place(point: { x: number; y: number }): void {
		this.agent.style.transform = `translate(${point.x}px, ${point.y}px)`;
	}

	move(tl: Timeline, point: { x: number; y: number }, at: number, dur = 0.5) {
		return tl.to(
			this.agent,
			{ transform: `translate(${point.x}px, ${point.y}px)` },
			at,
			{ dur, ease: ease.inOut },
		);
	}

	/** A click ripple where the pointer is. */
	tap(tl: Timeline, at: number): number {
		return tl.keyframes(
			this.click,
			[
				{ opacity: 1, transform: "scale(0.4)" },
				{ opacity: 0, transform: "scale(1.5)" },
			],
			at,
			{ dur: 0.45, ease: ease.out },
		);
	}
}

/** A list of CI runs. Older runs scroll away once it's full. */
export class RunList {
	readonly element: HTMLElement;
	private readonly list: HTMLElement;
	private readonly visible: number;
	private readonly rowHeight: number;
	private rows = 0;

	constructor(visible: number, rowHeight = 34) {
		this.visible = visible;
		this.rowHeight = rowHeight;
		this.list = h("div");
		this.element = h("div.runs", this.list);
		this.element.style.height = `${visible * rowHeight}px`;
	}

	add(
		tl: Timeline,
		at: number,
		parts: { status: Node; num: string; what: Node | string; meta?: string },
	): HTMLElement {
		const row = h(
			"div.run",
			parts.status,
			h("span.num", parts.num),
			h("span.what", parts.what),
			parts.meta ? h("span.meta", parts.meta) : null,
		);
		this.list.append(row);
		this.rows += 1;
		tl.enter(row, at, { y: 10, dur: 0.35 });
		if (this.rows > this.visible) {
			tl.to(
				this.list,
				{
					transform: `translateY(${-(this.rows - this.visible) * this.rowHeight}px)`,
				},
				at,
				{ dur: 0.35, ease: ease.inOut },
			);
		}
		return row;
	}
}
