import { $, h, html } from "./dom.ts";
import { highlight } from "./highlight.ts";
import { icon, type IconName } from "./icons.ts";

/**
 * Part of a line. A piece with an `id` can be found and animated on its own:
 * `typed` pieces start empty for `Timeline.type`, and `erasable` ones start
 * full for `Timeline.erase`.
 */
export type Piece =
	| string
	| { id: string; text: string; typed?: boolean; erasable?: boolean };

export interface Line {
	/** Finds the row with `CodeView.row`. */
	key?: string;
	code: string | Piece[];
	class?: string;
}

/** A block of numbered code lines. Line numbers come from a CSS counter. */
export class CodeView {
	readonly element: HTMLElement;

	constructor(lines: Line[], className = "") {
		this.element = h(`div.lines${className ? `.${className}` : ""}`);
		for (const line of lines) this.element.append(row(line));
	}

	row(key: string): HTMLElement {
		return $(this.element, `[data-key="${key}"]`);
	}

	rows(...keys: string[]): HTMLElement[] {
		return keys.map((key) => this.row(key));
	}

	piece(id: string): HTMLElement {
		return $(this.element, `[data-piece="${id}"]`);
	}

	/** Adds a gutter icon to a row, hidden until a timeline shows it. */
	status(key: string, name: IconName, tone: string): HTMLElement {
		const slot = $(this.row(key), ".st");
		const element = h(`span.st-icon.${tone}`, icon(name));
		if (name === "spinner") element.classList.add("spin");
		element.style.opacity = "0";
		slot.append(element);
		return element;
	}

	/** Inserts an element after a row, outside the line count. */
	after(key: string, element: HTMLElement): HTMLElement {
		this.row(key).after(element);
		return element;
	}
}

export function row(line: Line): HTMLElement {
	const code = h("span.code");
	const pieces = typeof line.code === "string" ? [line.code] : line.code;
	for (const piece of pieces) {
		if (typeof piece === "string") {
			code.append(html(highlight(piece)));
			continue;
		}
		const span = h("span.piece", { "data-piece": piece.id });
		span.append(html(highlight(piece.text)));
		if (piece.typed || piece.erasable) {
			span.classList.add("typed");
			code.append(span, h("span.caret"));
		} else {
			code.append(span);
		}
	}
	// Mark the intent passed to `ai.do`, so a timeline can sweep a highlight.
	for (const string of code.querySelectorAll(".tok-s")) {
		const before = string.previousElementSibling;
		if (
			before?.textContent === "(" &&
			precedingText(string).endsWith("ai.do")
		) {
			string.classList.add("intent");
		}
	}

	return h(
		`div.row${line.class ? `.${line.class}` : ""}`,
		{ "data-key": line.key },
		h("span.gut", h("span.st"), h("span.ln")),
		code,
	);
}

function precedingText(element: Element): string {
	let text = "";
	let node = element.previousElementSibling?.previousElementSibling;
	for (let i = 0; node && i < 3; i++) {
		text = (node.textContent ?? "") + text;
		node = node.previousElementSibling;
	}
	return text;
}

export interface Tab {
	id: string;
	label: string;
	lines: Line[];
}

/** An editor window with tabs. Each tab is a `CodeView`, stacked. */
export class Editor {
	readonly element: HTMLElement;
	private readonly tabs = new Map<string, HTMLElement>();
	private readonly views = new Map<string, CodeView>();

	constructor(tabs: Tab[]) {
		const bar = h("div.tabs");
		const body = h("div.views");
		tabs.forEach((tab, index) => {
			const button = h(
				"div.tab",
				icon("file", "tab-icon"),
				h("span", tab.label),
			);
			const view = new CodeView(tab.lines);
			view.element.classList.add("view");
			if (index > 0) {
				button.style.display = "none";
				view.element.style.opacity = "0";
			} else {
				button.classList.add("active");
			}
			bar.append(button);
			body.append(view.element);
			this.tabs.set(tab.id, button);
			this.views.set(tab.id, view);
		});
		this.element = h("div.panel.editor", bar, body);
	}

	view(id: string): CodeView {
		const view = this.views.get(id);
		if (!view) throw new Error(`No tab ${id}`);
		return view;
	}

	tab(id: string): HTMLElement {
		const tab = this.tabs.get(id);
		if (!tab) throw new Error(`No tab ${id}`);
		return tab;
	}
}

/** An inline view of another file, opened under a line like a peek. */
export function peek(options: {
	path: string;
	lines: Line[];
	badge?: string;
}): {
	element: HTMLElement;
	view: CodeView;
	badge: HTMLElement;
	sweep: HTMLElement;
} {
	const folders = options.path.slice(0, options.path.lastIndexOf("/") + 1);
	const file = options.path.slice(folders.length);
	const view = new CodeView(options.lines, "peek-lines");
	const badge = h("span.peek-badge", options.badge ?? "");
	const sweep = h("div.sweep");
	const element = h(
		"div.peek",
		h(
			"div.peek-head",
			icon("file", "peek-icon"),
			h("span.peek-path", h("span.dim", folders), h("strong", file)),
			badge,
		),
		h("div.peek-body", view.element, sweep),
	);
	return { element, view, badge, sweep };
}
