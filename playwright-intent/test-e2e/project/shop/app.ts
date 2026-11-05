import type { Page } from "playwright-intent";

/**
 * How the shop differs between runs, which is how flows make steps go stale.
 * - `baseline`: the shop that steps are usually generated against.
 * - `renamed-add-link`: one label changes, so one step goes stale.
 * - `redesigned`: every label changes, so every step goes stale.
 * - `broken-payment`: a real bug. Paying leads to an error page.
 */
export type ShopVariant =
	| "baseline"
	| "renamed-add-link"
	| "redesigned"
	| "broken-payment";

const variant = (process.env.SHOP_VARIANT ?? "baseline") as ShopVariant;
const redesigned = variant === "redesigned";

const labels = {
	add:
		redesigned || variant === "renamed-add-link"
			? "Buy blue shirt"
			: "Add blue shirt",
	checkout: redesigned ? "Continue to payment" : "Checkout",
	email: redesigned ? "Your email address" : "Email",
	pay: redesigned ? "Complete order" : "Pay",
};

function document(title: string, body: string): string {
	return `<!doctype html><title>${title}</title><main>${body}</main>`;
}

function render(url: URL): string {
	switch (url.pathname) {
		case "/":
			return document("Shop", `<h1>Shop</h1><a href="/cart">${labels.add}</a>`);
		case "/cart":
			return document(
				"Cart",
				`<h1>Your cart</h1><p>Blue shirt</p><a href="/checkout">${labels.checkout}</a>`,
			);
		case "/checkout":
			return document(
				"Checkout",
				`<h1>Checkout</h1>
				<form action="/confirmation">
					<label>${labels.email} <input name="email" /></label>
					<button>${labels.pay}</button>
				</form>`,
			);
		case "/confirmation":
			return variant === "broken-payment"
				? document("Error", "<h1>Payment failed</h1>")
				: document(
						"Thanks",
						`<h1>Thank you</h1><p>Receipt sent to ${url.searchParams.get("email")}</p>`,
					);
		default:
			return document("Not found", "<h1>Not found</h1>");
	}
}

/** Serves the shop at http://shop.test, with no server or port to manage. */
export async function installShop(page: Page): Promise<void> {
	await page.route("http://shop.test/**", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: render(new URL(route.request().url())),
		}),
	);
}
