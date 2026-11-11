import { $, h } from "./dom.ts";
import type { Scene } from "./scene.ts";
import { type Chapter, Timeline } from "./timeline.ts";

export interface LoadedScene {
	title: string;
	width: number;
	height: number;
	duration: number;
	chapters: Chapter[];
	seek(time: number): void;
}

declare global {
	interface Window {
		/** Set once the scene is built. The renderer drives it from here. */
		animation?: LoadedScene;
	}
}

const FONTS = [
	'400 13px "JetBrains Mono"',
	'600 13px "JetBrains Mono"',
	"400 13px Inter",
	"500 13px Inter",
	"600 13px Inter",
	"700 13px Inter",
];

const params = new URLSearchParams(location.search);
const capture = params.has("capture");
const theme = params.get("theme") === "dark" ? "dark" : "light";

const names = (await (await fetch("/scenes.json")).json()) as string[];
const name = params.get("scene") ?? names[0];
if (!name || !names.includes(name)) throw new Error(`No scene ${name}`);

await Promise.all(FONTS.map((font) => document.fonts.load(font)));
const { default: scene } = (await import(`/scenes/${name}.ts`)) as {
	default: Scene;
};

const stage = h("div.stage", { "data-theme": theme });
stage.style.width = `${scene.width}px`;
stage.style.height = `${scene.height}px`;
const frame = $(document, "#frame");
frame.append(stage);

const tl = new Timeline();
scene.build(stage, tl);
tl.seek(0);

window.animation = {
	title: scene.title,
	width: scene.width,
	height: scene.height,
	duration: tl.duration,
	chapters: tl.chapters,
	seek: (time) => tl.seek(time),
};

if (capture) document.body.classList.add("capture");
else preview();

/** Playback controls, and a reload that keeps your place when files change. */
function preview(): void {
	const controls = $(document, "#controls");
	const play = $(document, "#play") as HTMLButtonElement;
	const scrub = $(document, "#scrub") as HTMLInputElement;
	const time = $(document, "#time");
	const speed = $(document, "#speed") as HTMLSelectElement;
	const themeButton = $(document, "#theme") as HTMLButtonElement;
	const sceneSelect = $(document, "#scene") as HTMLSelectElement;
	const chapterBar = $(document, "#chapters");
	controls.hidden = false;
	document.title = `${scene.title} · animations`;

	const duration = tl.duration;
	let current = Number.parseFloat(
		location.hash.match(/t=([\d.]+)/)?.[1] ?? "0",
	);
	let playing = !location.hash.includes("paused");
	let last = performance.now();
	scrub.max = String(duration);

	for (const option of names) {
		sceneSelect.append(h("option", { value: option }, option));
	}
	sceneSelect.value = name!;
	sceneSelect.onchange = () => navigate({ scene: sceneSelect.value });

	themeButton.textContent = theme === "dark" ? "Light" : "Dark";
	themeButton.onclick = () =>
		navigate({ theme: theme === "dark" ? "light" : "dark" });

	const chapterButtons = tl.chapters.map((chapter, index) => {
		const button = h("button", `${index + 1}. ${chapter.title}`);
		button.onclick = () => show(chapter.at);
		chapterBar.append(button);
		return button;
	});

	function navigate(changes: Record<string, string>): void {
		const next = new URLSearchParams(location.search);
		for (const [key, value] of Object.entries(changes)) next.set(key, value);
		location.search = next.toString();
	}

	function fit(): void {
		const available = window.innerWidth - 48;
		const scale = Math.min(1.5, available / scene.width);
		frame.style.transform = `scale(${scale})`;
		frame.style.height = `${scene.height * scale}px`;
	}
	fit();
	window.addEventListener("resize", fit);

	function show(at: number): void {
		current = Math.max(0, Math.min(duration, at));
		tl.seek(current);
		scrub.value = String(current);
		time.textContent = `${current.toFixed(2)} / ${duration.toFixed(1)}s`;
		chapterButtons.forEach((button, index) => {
			const chapter = tl.chapters[index]!;
			const next = tl.chapters[index + 1]?.at ?? duration;
			button.classList.toggle(
				"current",
				current >= chapter.at && current < next,
			);
		});
		history.replaceState(
			null,
			"",
			`#t=${current.toFixed(2)}${playing ? "" : "&paused"}`,
		);
	}

	function tick(now: number): void {
		if (playing) {
			const next = current + ((now - last) / 1000) * Number(speed.value);
			show(next >= duration ? 0 : next);
		}
		last = now;
		requestAnimationFrame(tick);
	}

	function toggle(): void {
		playing = !playing;
		play.textContent = playing ? "Pause" : "Play";
		show(current);
	}

	play.textContent = playing ? "Pause" : "Play";
	play.onclick = toggle;
	scrub.oninput = () => {
		playing = false;
		play.textContent = "Play";
		show(Number(scrub.value));
	};
	document.addEventListener("keydown", (event) => {
		if (event.target instanceof HTMLSelectElement) return;
		const step = event.shiftKey ? 1 : 1 / 30;
		if (event.key === " ") toggle();
		else if (event.key === "ArrowRight") show(current + step);
		else if (event.key === "ArrowLeft") show(current - step);
		else return;
		event.preventDefault();
	});

	show(current);
	requestAnimationFrame(tick);
	new EventSource("/events").onmessage = () => location.reload();
}
