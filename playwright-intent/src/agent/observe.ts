import type { Page } from "@playwright/test";
import type { Observation } from "./agent";

export async function observePage(page: Page): Promise<Observation> {
	const [ariaSnapshot, screenshot, consoleMessages, pageErrors] =
		await Promise.all([
			page.ariaSnapshot({ mode: "ai" }).catch(() => null),
			page.screenshot().catch(() => null),
			page.consoleMessages(),
			page.pageErrors(),
		]);

	return {
		url: page.url(),
		title: await page.title().catch(() => ""),
		ariaSnapshot,
		screenshot,
		console: consoleMessages.map(
			(message) => `${message.type()}: ${message.text()}`,
		),
		pageErrors: pageErrors.map((error) => error.message),
	};
}
