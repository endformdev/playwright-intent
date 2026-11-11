import { html } from "./dom.ts";

const PATHS = {
	check: '<path d="M3.5 8.5l3 3 6-7"/>',
	cross: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
	spinner: '<path d="M8 2.5a5.5 5.5 0 1 1-5.5 5.5" />',
	replay:
		'<path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M11.8 1.8v2.8H9"/><path d="M6.8 6v4l3.2-2z" fill="currentColor" stroke="none"/>',
	file: '<path d="M4 1.8h5l3 3v9.4H4z"/><path d="M9 1.8v3h3"/>',
	folder: '<path d="M1.8 4.2v8.6h12.4V5.6H7.6L6.2 4.2z"/>',
	pr: '<circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="12.5" r="1.6"/><path d="M4.5 5.1v5.8M11.5 10.9V6.5a2 2 0 0 0-2-2H7.2"/><path d="M8.6 3.1L7.2 4.5l1.4 1.4"/>',
	merge:
		'<circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="9" r="1.6"/><path d="M4.5 5.1v5.8M4.5 5.5c0 2.5 2 3.5 5.4 3.5"/>',
	commit: '<circle cx="8" cy="8" r="2.6"/><path d="M1.5 8h3.9M10.6 8h3.9"/>',
	cloud:
		'<path d="M4.6 12.5h7.2a3 3 0 0 0 .4-6 4.2 4.2 0 0 0-8-1A3.3 3.3 0 0 0 4.6 12.5z"/>',
	server:
		'<rect x="2" y="2.5" width="12" height="4.5" rx="1"/><rect x="2" y="9" width="12" height="4.5" rx="1"/><path d="M4.5 4.8h.01M4.5 11.2h.01"/>',
	sparkle:
		'<path d="M8 1.5l1.5 4.2 4.2 1.5-4.2 1.5L8 12.9 6.5 8.7 2.3 7.2l4.2-1.5z" fill="currentColor" stroke="none"/><path d="M13 11.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="currentColor" stroke="none"/>',
	cart: '<path d="M1.5 2.5h2l1.6 7.5h7.4l1.5-5.5H4.3"/><circle cx="6" cy="13" r="1"/><circle cx="11.5" cy="13" r="1"/>',
	play: '<path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke="none"/>',
	bot: '<rect x="2.5" y="5" width="11" height="8" rx="2"/><path d="M8 2.5V5M5.8 9h.01M10.2 9h.01"/>',
	eye: '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/>',
	lock: '<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7"/>',
	branch:
		'<circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="4.5" r="1.6"/><path d="M4.5 5.1v5.8M11.5 6.1c0 3-7 2-7 4.8"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, className = ""): SVGElement {
	const fragment = html(
		`<svg class="icon ${className}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`,
	);
	return fragment.firstElementChild as SVGElement;
}

/** The pointer the agent drives in a browser mock. */
export function pointer(): SVGElement {
	const fragment = html(
		`<svg class="pointer" viewBox="0 0 20 22" width="20" height="22" aria-hidden="true"><path d="M2 1.5l14.5 10.2-6.6 1 3.7 7.1-2.6 1.3-3.7-7.2-5.3 4.4z" fill="var(--pointer)" stroke="var(--pointer-edge)" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
	);
	return fragment.firstElementChild as SVGElement;
}
