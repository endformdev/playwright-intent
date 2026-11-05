import { test as intentTest } from "playwright-intent";
import { installShop } from "../shop/app";

export { expect } from "playwright-intent";

export const test = intentTest.extend<{ shop: void }>({
	shop: [
		async ({ page }, use) => {
			await installShop(page);
			await use();
		},
		{ auto: true },
	],
});
