/**
 * A scene is built once, up front, as a stack of paused Web Animations with
 * absolute start times. Seeking sets every animation's `currentTime`, so any
 * frame can be rendered in any order, and the same frame always looks the
 * same.
 *
 * Every animation fills forwards only. An element's starting state is its own
 * style, and each tween goes from whatever the animations before it left
 * behind. Tweens on the same property must be added in time order.
 */

export const ease = {
	out: "cubic-bezier(0.22, 1, 0.36, 1)",
	inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
	in: "cubic-bezier(0.55, 0, 1, 0.45)",
	linear: "linear",
	spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;

export interface Chapter {
	title: string;
	at: number;
}

export interface TweenOptions {
	dur?: number;
	ease?: string;
}

type Targets = Element | readonly Element[];
type Props = Record<string, string | number>;

export class Timeline {
	readonly animations: Animation[] = [];
	readonly chapters: Chapter[] = [];
	private last = 0;

	/** The scene's length: the last thing scheduled, or a later `hold`. */
	get duration(): number {
		return this.last;
	}

	/** Starts a captioned chapter. */
	chapter(title: string, at: number): void {
		this.chapters.push({ title, at });
		this.extend(at);
	}

	/** Keeps the scene running until `at`, even if nothing moves. */
	hold(at: number): number {
		this.extend(at);
		return at;
	}

	/** Tweens from the current state to `props`. Returns the end time. */
	to(targets: Targets, props: Props, at: number, options: TweenOptions = {}) {
		const dur = options.dur ?? 0.4;
		for (const target of list(targets)) {
			this.animate(target, [props], at, dur, options.ease ?? ease.out);
		}
		return at + dur;
	}

	/** Animates through explicit keyframes. Returns the end time. */
	keyframes(
		targets: Targets,
		frames: Keyframe[],
		at: number,
		options: TweenOptions & { iterations?: number } = {},
	): number {
		const dur = options.dur ?? 0.4;
		for (const target of list(targets)) {
			this.animate(
				target,
				frames,
				at,
				dur,
				options.ease ?? ease.out,
				options.iterations,
			);
		}
		return at + dur * (options.iterations ?? 1);
	}

	/** Switches `props` instantly at `at`. */
	set(targets: Targets, props: Props, at: number): number {
		for (const target of list(targets)) {
			this.animate(target, [props, props], at, 0.001, ease.linear);
		}
		return at;
	}

	/** Fades in, rising from `y` pixels below. Hidden until then. */
	enter(
		targets: Targets,
		at: number,
		options: TweenOptions & { y?: number; x?: number; scale?: number } = {},
	): number {
		const { x = 0, y = 8, scale = 1 } = options;
		for (const target of list(targets)) {
			style(target, {
				opacity: "0",
				transform: `translate(${x}px, ${y}px) scale(${scale})`,
			});
		}
		return this.to(
			targets,
			{ opacity: 1, transform: "translate(0px, 0px) scale(1)" },
			at,
			{ dur: 0.45, ...options },
		);
	}

	/** Fades out, moving `y` pixels. */
	exit(
		targets: Targets,
		at: number,
		options: TweenOptions & { y?: number; x?: number; scale?: number } = {},
	): number {
		const { x = 0, y = -6, scale = 1 } = options;
		return this.to(
			targets,
			{
				opacity: 0,
				transform: `translate(${x}px, ${y}px) scale(${scale})`,
			},
			at,
			{ dur: 0.35, ease: ease.in, ...options },
		);
	}

	fadeIn(targets: Targets, at: number, options: TweenOptions = {}): number {
		for (const target of list(targets)) style(target, { opacity: "0" });
		return this.to(targets, { opacity: 1 }, at, { dur: 0.3, ...options });
	}

	fadeOut(targets: Targets, at: number, options: TweenOptions = {}): number {
		return this.to(targets, { opacity: 0 }, at, { dur: 0.3, ...options });
	}

	/**
	 * Grows from zero height to its natural height, then back to `auto`, so
	 * later changes inside it still move what's below. Until then it's out of
	 * the layout, so it takes no margin or line number.
	 */
	expand(targets: Targets, at: number, options: TweenOptions = {}): number {
		const dur = options.dur ?? 0.35;
		for (const target of list(targets)) {
			const height = naturalHeight(target);
			const { display } = getComputedStyle(target);
			hiddenDisplay.set(target, display);
			style(target, {
				display: "none",
				height: "0px",
				opacity: "0",
				overflow: "hidden",
			});
			this.set(target, { display }, at);
			this.animate(
				target,
				[{ height: `${height}px`, opacity: 1 }],
				at,
				dur,
				options.ease ?? ease.out,
			);
			this.set(target, { height: "auto" }, at + dur);
		}
		return at + dur;
	}

	/** Shrinks to zero height, then leaves the layout. */
	collapse(targets: Targets, at: number, options: TweenOptions = {}): number {
		const dur = options.dur ?? 0.3;
		for (const target of list(targets)) {
			const height = naturalHeight(target);
			this.animate(
				target,
				[
					{ height: `${height}px`, overflow: "hidden" },
					{ height: "0px", opacity: 0, overflow: "hidden" },
				],
				at,
				dur,
				options.ease ?? ease.inOut,
			);
			this.set(target, { display: "none" }, at + dur);
		}
		return at + dur;
	}

	/**
	 * Types an element's text one character at a time. The element must be a
	 * `.typed` span in a monospace font, so each character is `1ch` wide.
	 */
	type(target: Element, at: number, options: { cps?: number } = {}): number {
		const length = columns(target);
		const dur = length / (options.cps ?? 32);
		style(target, { maxWidth: "0ch" });
		this.animate(
			target,
			[{ maxWidth: "0ch" }, { maxWidth: `${length}ch` }],
			at,
			dur,
			`steps(${length}, end)`,
		);
		this.caret(target, at, at + dur);
		return at + dur;
	}

	/** Deletes a `.typed` span's text, last character first. */
	erase(target: Element, at: number, options: { cps?: number } = {}): number {
		const length = columns(target);
		const dur = length / (options.cps ?? 60);
		this.animate(
			target,
			[{ maxWidth: `${length}ch` }, { maxWidth: "0ch" }],
			at,
			dur,
			`steps(${length}, end)`,
		);
		this.caret(target, at, at + dur);
		return at + dur;
	}

	/** Runs `frames` forever, from the start, while `target` is visible. */
	loop(target: Element, frames: Keyframe[], period: number): void {
		const animation = target.animate(frames, {
			duration: period * 1000,
			iterations: Infinity,
		});
		this.track(animation);
	}

	private caret(target: Element, from: number, to: number): void {
		const caret = target.nextElementSibling;
		if (!caret?.classList.contains("caret")) return;
		this.set(caret, { opacity: 1 }, from);
		this.set(caret, { opacity: 0 }, to + 0.35);
	}

	private animate(
		target: Element,
		frames: Keyframe[],
		at: number,
		dur: number,
		easing: string,
		iterations = 1,
	): void {
		const animation = target.animate(frames, {
			delay: at * 1000,
			duration: dur * 1000,
			easing,
			iterations,
			fill: "forwards",
		});
		this.track(animation);
		this.extend(at + dur * (Number.isFinite(iterations) ? iterations : 0));
	}

	private track(animation: Animation): void {
		animation.pause();
		animation.persist();
		this.animations.push(animation);
	}

	private extend(at: number): void {
		this.last = Math.max(this.last, at);
	}

	/** Shows the frame at `time` seconds. */
	seek(time: number): void {
		for (const animation of this.animations) {
			animation.currentTime = time * 1000;
		}
	}
}

function list(targets: Targets): readonly Element[] {
	return targets instanceof Element ? [targets] : targets;
}

/** How many `ch` a monospace element's text takes, with tabs two wide. */
function columns(target: Element): number {
	return (target.textContent ?? "").replaceAll("\t", "  ").length;
}

/** The `display` each element had before `expand` hid it. */
const hiddenDisplay = new WeakMap<Element, string>();

/**
 * An element's height when it and its ancestors are shown, whatever earlier
 * `expand` and `collapse` calls did to their starting styles.
 */
function naturalHeight(target: Element): number {
	const changed: [HTMLElement, string, string][] = [];
	for (
		let node = target as HTMLElement | null;
		node;
		node = node.parentElement
	) {
		const display = hiddenDisplay.get(node);
		if (node !== target && display === undefined) continue;
		changed.push([node, node.style.display, node.style.height]);
		if (display !== undefined) node.style.display = display;
		if (node === target) node.style.height = "";
	}
	const height = (target as HTMLElement).offsetHeight;
	for (const [node, display, height] of changed) {
		node.style.display = display;
		node.style.height = height;
	}
	return height;
}

function style(target: Element, props: Record<string, string>): void {
	Object.assign((target as HTMLElement).style, props);
}
