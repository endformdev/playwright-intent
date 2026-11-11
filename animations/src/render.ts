import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { type Browser, chromium } from "@playwright/test";
import sharp from "sharp";
import { sceneNames, startServer } from "./server.ts";

const REPOSITORY = path.resolve(fileURLToPath(import.meta.url), "../../..");

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		theme: { type: "string", multiple: true },
		format: { type: "string", multiple: true },
		fps: { type: "string", default: "24" },
		scale: { type: "string", default: "2" },
		out: {
			type: "string",
			default: path.join(REPOSITORY, "docs/assets/animations"),
		},
		from: { type: "string" },
		to: { type: "string" },
	},
});

const fps = Number(values.fps);
const scale = Number(values.scale);
const themes = values.theme ?? ["light", "dark"];
const formats = values.format ?? ["webp", "webm"];
const all = await sceneNames();
const scenes = positionals.length > 0 ? positionals : all;
for (const scene of scenes) {
	if (!all.includes(scene)) throw new Error(`No scene called ${scene}`);
}

const server = await startServer();
const browser = await chromium.launch();
try {
	for (const scene of scenes) {
		await Promise.all(themes.map((theme) => render(browser, scene, theme)));
	}
} finally {
	await browser.close();
	await server.close();
}

interface Frames {
	directory: string;
	files: string[];
	/** How long each file stays on screen, in milliseconds. */
	delays: number[];
}

async function render(browser: Browser, name: string, theme: string) {
	const label = `${name}-${theme}`;
	const started = performance.now();
	const frames = await capture(browser, name, theme);
	console.log(
		`${label}: captured ${frames.files.length} distinct frames in ${seconds(started)}`,
	);
	await mkdir(values.out, { recursive: true });

	try {
		for (const format of formats) {
			const file = path.join(values.out, `${label}.${format}`);
			const encoding = performance.now();
			if (format === "webp") await encodeWebp(frames, file);
			else if (format === "webm") await encodeWebm(frames, file);
			else throw new Error(`Unknown format ${format}`);
			const { size } = await stat(file);
			console.log(
				`${path.relative(REPOSITORY, file)}: ${(size / 1024 / 1024).toFixed(2)} MB in ${seconds(encoding)}`,
			);
		}
	} finally {
		await rm(frames.directory, { recursive: true, force: true });
	}
}

function seconds(since: number): string {
	return `${((performance.now() - since) / 1000).toFixed(0)}s`;
}

/** Screenshots every frame, merging runs of identical frames into one. */
async function capture(
	browser: Browser,
	name: string,
	theme: string,
): Promise<Frames> {
	const context = await browser.newContext({ deviceScaleFactor: scale });
	const page = await context.newPage();
	page.on("pageerror", (error) => console.error(error));
	await page.goto(
		`${server.url}/player.html?scene=${name}&theme=${theme}&capture`,
	);
	await page.waitForFunction(() => window.animation);
	const scene = await page.evaluate(() => {
		const { width, height, duration } = window.animation!;
		return { width, height, duration };
	});
	await page.setViewportSize({ width: scene.width, height: scene.height });

	const directory = await mkdtemp(path.join(tmpdir(), `animation-${name}-`));
	const frames: Frames = { directory, files: [], delays: [] };
	const first = Math.round(Number(values.from ?? 0) * fps);
	const last = Math.round(Number(values.to ?? scene.duration) * fps);
	const step = 1000 / fps;
	let previous: Buffer | null = null;

	for (let index = first; index < last; index++) {
		await page.evaluate((time) => window.animation!.seek(time), index / fps);
		const image = await page.screenshot({
			clip: { x: 0, y: 0, width: scene.width, height: scene.height },
		});
		if (previous?.equals(image)) {
			frames.delays[frames.delays.length - 1]! += step;
			continue;
		}
		const file = path.join(directory, `${String(index).padStart(5, "0")}.png`);
		await writeFile(file, image);
		frames.files.push(file);
		frames.delays.push(step);
		previous = image;
	}

	await context.close();
	return frames;
}

/**
 * Lossless keeps text sharp, and it's smaller than lossy here, because UI
 * frames are flat colour and only small parts change between them.
 */
async function encodeWebp(frames: Frames, file: string): Promise<void> {
	await sharp(frames.files, { join: { animated: true } })
		.webp({
			lossless: true,
			effort: 6,
			loop: 0,
			delay: wholeMilliseconds(frames.delays),
		})
		.toFile(file);
}

/** Rounds the running total, so rounding errors don't add up over a scene. */
function wholeMilliseconds(delays: number[]): number[] {
	let elapsed = 0;
	return delays.map((delay) => {
		const start = Math.round(elapsed);
		elapsed += delay;
		return Math.round(elapsed) - start;
	});
}

async function encodeWebm(frames: Frames, file: string): Promise<void> {
	const list = frames.files
		.map(
			(frame, index) =>
				`file '${frame}'\nduration ${(frames.delays[index]! / 1000).toFixed(6)}`,
		)
		.join("\n");
	const listFile = path.join(frames.directory, "frames.txt");
	// The concat demuxer ignores the last duration unless the file repeats.
	await writeFile(listFile, `${list}\nfile '${frames.files.at(-1)}'\n`);

	await run("ffmpeg", [
		"-y",
		"-loglevel",
		"error",
		"-f",
		"concat",
		"-safe",
		"0",
		"-i",
		listFile,
		"-vf",
		`fps=${fps},format=yuv420p`,
		"-c:v",
		"libvpx-vp9",
		"-crf",
		"28",
		"-b:v",
		"0",
		"-row-mt",
		"1",
		file,
	]);
}

function run(command: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: "inherit" });
		child.on("error", (error) =>
			reject(
				new Error(`Couldn't run ${command}. Is it installed?`, {
					cause: error,
				}),
			),
		);
		child.on("exit", (code) =>
			code === 0
				? resolve()
				: reject(new Error(`${command} exited with ${code}`)),
		);
	});
}
