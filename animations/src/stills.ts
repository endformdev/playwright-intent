import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { startServer } from "./server.ts";

/**
 * Screenshots a scene at chosen times, to check frames without rendering the
 * whole thing: `pnpm stills 3.4 12 20.5 --theme dark`.
 */
const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		scene: { type: "string", default: "overview" },
		theme: { type: "string", default: "light" },
		out: { type: "string", default: path.join(tmpdir(), "animation-stills") },
	},
});

await mkdir(values.out, { recursive: true });
const server = await startServer();
const browser = await chromium.launch();
try {
	const page = await browser.newPage({ deviceScaleFactor: 2 });
	page.on("pageerror", (error) => console.error(error));
	page.on("console", (message) => console.log(message.text()));
	await page.goto(
		`${server.url}/player.html?scene=${values.scene}&theme=${values.theme}&capture`,
	);
	await page.waitForFunction(() => window.animation);
	const { width, height, duration } = await page.evaluate(() => ({
		width: window.animation!.width,
		height: window.animation!.height,
		duration: window.animation!.duration,
	}));
	console.log(`duration ${duration}s`);
	await page.setViewportSize({ width, height });
	for (const time of positionals.map(Number)) {
		await page.evaluate((t) => window.animation!.seek(t), time);
		const file = path.resolve(
			values.out,
			`${values.scene}-${values.theme}-${time}.png`,
		);
		await page.screenshot({ path: file, clip: { x: 0, y: 0, width, height } });
		console.log(file);
	}
} finally {
	await browser.close();
	await server.close();
}
