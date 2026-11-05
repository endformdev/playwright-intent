import type { Page } from "@playwright/test";
import type { Observation } from "./agent";

const MAX_TEST_IDS = 50;

export async function observePage(
	page: Page,
	testIdAttribute: string,
): Promise<Observation> {
	const [ariaSnapshot, testIds, screenshot, consoleMessages, pageErrors] =
		await Promise.all([
			page.ariaSnapshot({ mode: "ai" }).catch(() => null),
			readTestIds(page, testIdAttribute).catch(() => []),
			page.screenshot().catch(() => null),
			page.consoleMessages(),
			page.pageErrors(),
		]);

	return {
		url: page.url(),
		title: await page.title().catch(() => ""),
		ariaSnapshot,
		testIds,
		screenshot,
		console: consoleMessages.map(
			(message) => `${message.type()}: ${message.text()}`,
		),
		pageErrors: pageErrors.map((error) => error.message),
	};
}

function readTestIds(page: Page, attribute: string): Promise<string[]> {
	return page.locator(`[${attribute}]`).evaluateAll(
		(elements, { attribute, limit }) =>
			elements.slice(0, limit).map((element) => {
				const text = element.textContent?.trim().slice(0, 40) ?? "";
				const tag = element.tagName.toLowerCase();
				return `${element.getAttribute(attribute)}: <${tag}> ${text}`;
			}),
		{ attribute, limit: MAX_TEST_IDS },
	);
}
