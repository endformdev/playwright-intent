import { h } from "./dom.ts";
import { ease, type Timeline } from "./timeline.ts";

export interface Scene {
	/** Shown in the preview, and used as the image's alt text. */
	title: string;
	width: number;
	height: number;
	/** Builds the stage's DOM and schedules everything on `tl`. */
	build(stage: HTMLElement, tl: Timeline): void;
}

export function defineScene(scene: Scene): Scene {
	return scene;
}

export interface ChapterSpec {
	title: string;
	sub?: string;
	at: number;
}

/**
 * A numbered caption for each chapter, with a segment per chapter that fills
 * as it starts. Each chapter runs
 * until the next one starts, and the last until `end`.
 */
export function chapters(
	stage: HTMLElement,
	tl: Timeline,
	list: ChapterSpec[],
	end: number,
): void {
	const captions = h("div.captions");
	const progress = h("div.progress");
	stage.append(h("div.topbar", captions, progress));

	list.forEach((chapter, index) => {
		const until = list[index + 1]?.at ?? end;
		const caption = h(
			"div.caption",
			h("span.n", String(index + 1)),
			h("span", chapter.title),
			chapter.sub ? h("span.sub", chapter.sub) : null,
		);
		captions.append(caption);
		tl.chapter(chapter.title, chapter.at);
		tl.enter(caption, chapter.at, { y: 10, dur: 0.5 });
		if (index < list.length - 1) tl.exit(caption, until - 0.3, { y: -10 });
		else tl.fadeOut(caption, until);

		const fill = h("i");
		progress.append(h("span", fill));
		// Filled at once rather than over the chapter, so frames where nothing
		// else moves stay identical, and the renderer can merge them.
		tl.to(fill, { transform: "scaleX(1)" }, chapter.at, {
			dur: 0.6,
			ease: ease.out,
		});
		tl.set(fill, { transform: "scaleX(0)" }, end + 0.6);
	});
}

/** A full-stage card, to open and close a looping scene on. */
export function titleCard(content: Node[]): HTMLElement {
	return h("div.title-card", ...content);
}
