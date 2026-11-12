import {
	card,
	place,
	RunList,
	ShopBrowser,
	spinner,
	swap,
} from "../runtime/cards.ts";
import { $, h } from "../runtime/dom.ts";
import { Editor, peek } from "../runtime/editor.ts";
import { icon } from "../runtime/icons.ts";
import { chapters, defineScene, titleCard } from "../runtime/scene.ts";
import { ease, type Timeline } from "../runtime/timeline.ts";

/**
 * The README's animation: write an intent, the agent saves a step, people
 * review it, runs replay it, the app changes, and the agent repairs the step
 * and commits the fix.
 */
/** When the last chapter ends and the title comes back. */
const END = 30.8;

export default defineScene({
	title:
		"A Playwright test's steps become one ai.do intent. The agent writes the step once as a TypeScript file, it's reviewed in a pull request, and later runs replay it without AI. When the app changes, the agent repairs the step and commits the fix.",
	width: 960,
	height: 540,
	build(stage, tl) {
		const right = { x: 612, w: 328 };
		const intro = titleCard([
			h("h1", "Playwright Intent"),
			h("p", "Plain-language Playwright steps, saved as code you can review."),
			h("div.install", h("span.dim", "$"), "npm install -D playwright-intent"),
		]);

		chapters(
			stage,
			tl,
			[
				{ title: "Describe steps in plain language", at: 1.2 },
				{ title: "The agent writes the step, once", at: 6.6 },
				{ title: "It's saved as code you review", at: 13.0 },
				{ title: "Every run replays it, with no AI", at: 16.6 },
				{ title: "The app changes, and the step fails", at: 20.2 },
				{ title: "The agent repairs it, and commits the fix", at: 23.6 },
			],
			END,
		);

		// The editor, on the left the whole time.
		const editor = new Editor([
			{
				id: "spec",
				label: "checkout.spec.ts",
				lines: [
					{
						key: "import",
						code: [
							"import { test, expect } from ",
							{ id: "pkg-old", text: '"@playwright/test"', erasable: true },
							{ id: "pkg-new", text: '"playwright-intent"', typed: true },
							";",
						],
					},
					{ code: "" },
					{
						key: "test",
						code: [
							'test("checkout", async ({ page',
							{ id: "ai-arg", text: ", ai", typed: true },
							" }) => {",
						],
					},
					{ key: "goto", code: '\tawait page.goto("/shop");' },
					{ key: "h1", code: '\tawait page.getByText("Shirts").click();' },
					{
						key: "h2",
						code: '\tawait page.getByLabel("Sort").selectOption("price");',
					},
					{
						key: "h3",
						code: '\tawait page.getByText("Add to cart").first().click();',
					},
					{
						key: "h4",
						code: '\tawait expect(page.getByTestId("cart")).toHaveText("1");',
					},
					{
						key: "ai",
						code: [
							"\t",
							{
								id: "ai-do",
								text: 'await ai.do("add the cheapest shirt to the cart");',
								typed: true,
							},
						],
					},
					{
						key: "checkout",
						code: '\tawait page.getByRole("link", { name: "Checkout" }).click();',
					},
					{
						key: "expect",
						code: '\tawait expect(page.getByText("1 item")).toBeVisible();',
					},
					{ code: "});" },
				],
			},
		]);
		place(editor.element, { x: 20, y: 60, w: 576, h: 460 });
		stage.append(editor.element);
		const spec = editor.view("spec");

		// The generated step, shown under the `ai.do` line.
		const step = peek({
			path: ".intent/…/add-the-cheapest-shirt-to-the-cart.ts",
			lines: [
				{ code: '// intent: "add the cheapest shirt to the cart"' },
				{ code: '// test: "checkout"' },
				{ code: 'import type { StepContext } from "playwright-intent";' },
				{ code: "" },
				{
					code: "export default async function ({ page, context, request, expect, vars }: StepContext): Promise<void> {",
				},
				{ key: "s1", code: '\tawait page.getByText("Shirts").click();' },
				{
					key: "s2",
					code: '\tawait page.getByLabel("Sort").selectOption("price");',
				},
				{
					key: "s3",
					code: '\tawait page.getByText("Add to cart").first().click();',
				},
				{
					key: "s3-fixed",
					code: '\tawait page.getByText("Add to bag").first().click();',
				},
				{
					key: "s4",
					code: '\tawait expect(page.getByTestId("cart")).toHaveText("1");',
				},
				{ code: "}" },
			],
		});
		spec.after("ai", step.element);
		const repairAt = 26.5;
		const fixed = step.view.row("s3-fixed");
		tl.expand(fixed, repairAt, { dur: 0.3 });
		const badges = {
			written: h("span.chip.ai", icon("sparkle"), "written by the agent"),
			replayed: h("span.chip.green", icon("replay"), "replayed, no AI"),
			failed: h("span.chip.red", icon("cross"), "click timed out"),
			repaired: h("span.chip.ai", icon("sparkle"), "repaired by the agent"),
		};
		step.badge.append(...Object.values(badges));
		for (const badge of Object.values(badges)) badge.style.opacity = "0";

		// Right column, chapters 1 and 2: the app, and the agent driving it.
		const runStatus = swap(
			h("span.mono.muted", icon("play"), "npx playwright test"),
			h("span", spinner(tl, "ai-spin"), "The agent is exploring the page…"),
			h(
				"span",
				h("span.green", icon("check")),
				"Step saved",
				h("span.muted", "· 1 model call"),
			),
		);
		const statusCard = place(h("div.panel", h("div.status", runStatus)), {
			x: right.x,
			y: 60,
			w: right.w,
		});

		const shop = new ShopBrowser({
			url: "localhost:3000/shop",
			nav: ["Shirts", "Hats"],
			sort: ["Featured", "Price: low to high"],
			products: [
				{ id: "oxford", name: "Oxford shirt", price: "$48", color: "#9db7d9" },
				{ id: "cap", name: "Baseball cap", price: "$9", color: "#e3b26b" },
				{ id: "linen", name: "Linen shirt", price: "$36", color: "#d9cbb0" },
				{ id: "tee", name: "Basic tee", price: "$12", color: "#c8d5b9" },
			],
		});
		place(shop.element, { x: right.x, y: 106, w: right.w });
		stage.append(statusCard, shop.element, intro);

		// Chapter 1: hand-written steps become an intent.
		// Wipes rather than fades: a wipe only changes a strip of each frame,
		// which keeps the image small.
		const edge = h("div.wipe-edge");
		stage.append(edge);
		wipe(tl, intro, edge, "out", 0.9);

		let t = tl.erase(spec.piece("pkg-old"), 1.7);
		t = tl.type(spec.piece("pkg-new"), t + 0.05);
		t = tl.type(spec.piece("ai-arg"), t + 0.25);
		const handWritten = spec.rows("h1", "h2", "h3", "h4");
		handWritten.forEach((row, index) =>
			tl.to(row, { backgroundColor: "var(--select)" }, 3.1 + index * 0.07, {
				dur: 0.2,
			}),
		);
		tl.collapse(handWritten, 3.9, { dur: 0.35 });
		tl.expand(spec.row("ai"), 3.95, { dur: 0.3 });
		t = tl.type(spec.piece("ai-do"), 4.25, { cps: 34 });
		const intent = $(spec.row("ai"), ".intent");
		tl.to(intent, { backgroundSize: "100% 80%" }, t + 0.1, { dur: 0.5 });

		// Chapter 2: the agent explores the live page, then saves the step.
		const ok = {
			goto: spec.status("goto", "check", "green"),
			aiSpin: spec.status("ai", "spinner", "ai"),
			ai: spec.status("ai", "check", "green"),
			aiFail: spec.status("ai", "cross", "red"),
			checkout: spec.status("checkout", "check", "green"),
			expect: spec.status("expect", "check", "green"),
		};
		tl.loop(
			ok.aiSpin,
			[{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
			0.8,
		);
		tl.enter(statusCard, 6.7, { y: 8 });
		tl.set(ok.goto, { opacity: 1 }, 6.9);
		tl.set(ok.aiSpin, { opacity: 1 }, 7.1);
		swapTo(tl, runStatus, 1, 7.1);
		tl.to(shop.element, { borderColor: "var(--yellow)" }, 7.1);

		const start = shop.point(shop.product("linen"));
		shop.place({ x: start.x + 60, y: start.y + 70 });
		tl.fadeIn(shop.agent, 7.2);
		t = shop.move(tl, shop.point(shop.nav.get("Shirts")!, 2), 7.4, 0.55);
		shop.tap(tl, t);
		tl.to(
			$(shop.nav.get("Shirts")!, "i"),
			{ transform: "scaleX(1)" },
			t + 0.05,
			{
				dur: 0.3,
			},
		);
		tl.to(
			shop.product("cap"),
			{ opacity: 0, transform: "scale(0.96)" },
			t + 0.1,
			{
				dur: 0.25,
			},
		);
		shop.arrange(tl, ["oxford", "linen", "tee"], t + 0.2);

		t = shop.move(tl, shop.point(shop.select, 2), 8.55, 0.45);
		shop.tap(tl, t);
		tl.enter(shop.menu, t + 0.05, { y: -4, dur: 0.2 });
		const option = shop.options[1]!;
		t = shop.move(tl, shop.point(option, 2), t + 0.3, 0.35);
		tl.to(option, { backgroundColor: "var(--select)" }, t - 0.1, { dur: 0.1 });
		shop.tap(tl, t);
		tl.fadeOut(shop.menu, t + 0.1, { dur: 0.15 });
		swapTo(tl, shop.select.querySelector(".value")!, 1, t + 0.1, 0.15);
		shop.arrange(tl, ["tee", "linen", "oxford"], t + 0.2);

		t = shop.move(tl, shop.buttonAt("tee", 0), t + 0.75, 0.45);
		shop.tap(tl, t);
		tl.set(shop.count, { opacity: 0 }, t + 0.05);
		tl.keyframes(
			shop.count2,
			[
				{ opacity: 1, transform: "scale(1.5)" },
				{ opacity: 1, transform: "scale(1)" },
			],
			t + 0.05,
			{ dur: 0.35, ease: ease.spring },
		);
		const found = t + 0.35;

		tl.fadeOut(shop.agent, found);
		tl.to(shop.element, { borderColor: "var(--border)" }, found);
		swapTo(tl, runStatus, 2, found + 0.1);
		tl.set(ok.aiSpin, { opacity: 0 }, found + 0.1);
		tl.expand(step.element, found + 0.1, { dur: 0.45 });
		// Lines appear one at a time, as if written, each in a single frame.
		[...step.view.element.children].forEach((line, index) => {
			(line as HTMLElement).style.opacity = "0";
			tl.set(line, { opacity: 1 }, found + 0.3 + index * 0.05);
		});
		tl.fadeIn(badges.written, found + 0.5);
		tl.set(ok.ai, { opacity: 1 }, found + 1.0);
		tl.set(ok.checkout, { opacity: 1 }, found + 1.25);
		tl.set(ok.expect, { opacity: 1 }, found + 1.5);
		tl.hold(12.6);

		// Chapter 3: the step is a file in the pull request.
		tl.exit([statusCard, shop.element], 13.05, { y: -8 });
		const merged = swap(
			h("span.chip.green", icon("pr"), "Open"),
			h("span.chip.purple", icon("merge"), "Merged"),
		);
		const specFile = fileRow("tests/checkout.spec.ts", "+3 −6");
		const stepFile = fileRow(
			".intent/tests/checkout.spec.ts/checkout/add-the-cheapest-shirt-to-the-cart.ts",
			"+10",
		);
		const approval = h(
			"div.person",
			h("span.avatar", { style: "background:#7a5af5" }, "AL"),
			h("span", h("strong", "Ada"), " approved these changes"),
			h("span.grow"),
			h("span.green", icon("check")),
		);
		const pr = place(
			card({
				icon: "pr",
				title: "Add checkout test",
				sub: "#42",
				right: merged,
				body: [h("div.files", specFile, stepFile), approval],
			}),
			{ x: right.x, y: 60, w: right.w },
		);
		stage.append(pr);
		tl.enter(pr, 13.4, { y: 12 });
		tl.enter(specFile, 13.7, { x: 8, y: 0 });
		tl.enter(stepFile, 13.85, { x: 8, y: 0 });
		tl.keyframes(
			[stepFile, step.element],
			[
				{ boxShadow: "0 0 0 0 transparent" },
				{ boxShadow: "0 0 0 3px var(--marker)" },
				{ boxShadow: "0 0 0 0 transparent" },
			],
			14.2,
			{ dur: 0.9, ease: ease.inOut },
		);
		tl.enter(approval, 14.7, { y: 6 });
		swapTo(tl, merged, 1, 15.5);
		tl.hold(16.4);

		// Chapter 4: CI replays the saved step, again and again.
		const runs = new RunList(6);
		const runsCard = place(
			card({
				icon: "server",
				title: "CI runs",
				sub: "main",
				body: [runs.element],
			}),
			{ x: right.x, y: 264, w: right.w },
		);
		stage.append(runsCard);
		tl.enter(runsCard, 16.7, { y: 12 });
		swapBadge(tl, badges, "replayed", 16.9);
		[17.0, 17.65, 18.3, 18.95].forEach((at, index) => {
			runs.add(tl, at, {
				status: h("span.green", icon("check")),
				num: `#${43 + index}`,
				what: h("span", "checkout ", h("span.muted", "replayed 1 step")),
				meta: "0 model calls",
			});
			sweep(tl, step.sweep, at - 0.05, 5, 8);
		});
		tl.hold(20.0);

		// Chapter 5: someone renames a button, and the step's click times out.
		tl.exit(pr, 20.3, { y: -8 });
		const appCommit = place(
			card({
				icon: "commit",
				title: "Rename “Add to cart”",
				sub: "a3f9e21",
				right: h("span.avatar", { style: "background:#d9772b" }, "SK"),
				body: [
					h(
						"div.commit-msg.mono",
						h("div.dim", "src/product-card.tsx"),
						h("div.red", "- <button>Add to cart</button>"),
						h("div.green", "+ <button>Add to bag</button>"),
					),
				],
			}),
			{ x: right.x, y: 60, w: right.w },
		);
		stage.append(appCommit);
		tl.enter(appCommit, 20.6, { y: 12 });

		const failing = swap(spinner(tl), h("span.red", icon("cross")));
		const failingWhat = swap(
			h("span", "checkout ", h("span.muted", "running…")),
			h("span", "checkout ", h("span.red", "failed in a step")),
		);
		runs.add(tl, 21.4, {
			status: failing,
			num: "#47",
			what: failingWhat,
		});
		sweep(tl, step.sweep, 21.45, 5, 7, 0.45, true);
		const failedAt = 22.0;
		const s3 = step.view.row("s3");
		const s3Fail = step.view.status("s3", "cross", "red");
		tl.to(s3, { backgroundColor: "var(--red-line)" }, failedAt, { dur: 0.2 });
		tl.set(s3Fail, { opacity: 1 }, failedAt);
		tl.set([ok.ai, ok.checkout, ok.expect], { opacity: 0 }, 21.4);
		tl.set(ok.aiFail, { opacity: 1 }, failedAt);
		swapTo(tl, failing, 1, failedAt);
		swapTo(tl, failingWhat, 1, failedAt);
		swapBadge(tl, badges, "failed", failedAt);
		tl.hold(23.4);

		// Chapter 6: the agent diagnoses the failure and repairs the step.
		tl.exit(appCommit, 23.7, { y: -8 });
		const thinking = swap(spinner(tl, "ai-spin"), h("span"));
		const reason = h(
			"div.prose",
			"The button now says ",
			h("q", "Add to bag"),
			". The intent still holds, so the step is out of date.",
		);
		const repair = h("span.choice", icon("check"), "repair");
		const choices = h(
			"div.choices",
			repair,
			h("span.choice", "regenerate"),
			h("span.choice", "fail"),
		);
		const realBug = h(
			"div.foot",
			"If the app is really broken, it picks ",
			h("code", "fail"),
			", and the test stays red with its reason.",
		);
		const diagnosis = place(
			card({
				title: h("span.chip.ai", icon("sparkle"), "agent"),
				sub: "Diagnosis",
				right: thinking,
				body: [reason, choices, realBug],
			}),
			{ x: right.x, y: 60, w: right.w },
		);
		stage.append(diagnosis);
		tl.enter(diagnosis, 23.95, { y: 12 });
		tl.enter(reason, 24.9, { y: 6 });
		[...choices.children].forEach((choice, index) =>
			tl.enter(choice, 25.4 + index * 0.08, { y: 6, dur: 0.3 }),
		);
		tl.enter(realBug, 25.7, { y: 6 });
		swapTo(tl, thinking, 1, 25.4);
		tl.to(
			repair,
			{
				borderColor: "var(--green)",
				color: "var(--green)",
				backgroundColor: "var(--green-bg)",
			},
			25.9,
			{ dur: 0.25 },
		);
		tl.to([...choices.children].slice(1), { opacity: 0.45 }, 25.9);

		tl.set(
			s3.querySelector(".code")!,
			{ textDecorationLine: "line-through" },
			repairAt - 0.3,
		);
		tl.set(s3Fail, { opacity: 0 }, repairAt - 0.1);
		tl.collapse(s3, repairAt, { dur: 0.3 });
		tl.set(fixed, { backgroundColor: "var(--green-line)" }, repairAt);
		swapBadge(tl, badges, "repaired", 26.8);

		runs.add(tl, 27.0, {
			status: h("span.green", icon("check")),
			num: "#47",
			what: h("span", "checkout ", h("span.muted", "passed on retry")),
			meta: "1 step repaired",
		});
		sweep(tl, step.sweep, 27.0, 5, 8);
		tl.set(ok.aiFail, { opacity: 0 }, 27.0);
		tl.set(ok.ai, { opacity: 1 }, 27.3);
		tl.set(ok.checkout, { opacity: 1 }, 27.5);
		tl.set(ok.expect, { opacity: 1 }, 27.7);

		const botCommit = place(
			card({
				icon: "commit",
				title: "github-actions",
				sub: "committed 2c8e1f4",
				right: h("span.avatar", { style: "background:#24292f" }, icon("bot")),
				body: [
					h(
						"div.commit-msg",
						h("strong", "Update Playwright Intent steps"),
						h(
							"code.muted",
							...breakable(
								"- repair .intent/tests/checkout.spec.ts/checkout/add-the-cheapest-shirt-to-the-cart.ts",
							),
						),
					),
					h(
						"div.foot",
						h("code", "commit()"),
						" pushes the fix to your pull request. ",
						h("code", "propose()"),
						" comments a patch instead.",
					),
				],
			}),
			{ x: right.x, y: 264, w: right.w },
		);
		stage.append(botCommit);
		tl.exit(runsCard, 28.3, { y: -8 });
		tl.enter(botCommit, 28.6, { y: 12 });
		tl.hold(END);

		// Back to the title, which is also the first frame, so it loops.
		wipe(tl, intro, edge, "in", END);
		tl.hold(END + 1.6);
	},
});

/** Fades in the `index`th child of a `swap`, and fades out the rest. */
function swapTo(
	tl: Timeline,
	element: Element,
	index: number,
	at: number,
	dur = 0.25,
): void {
	[...element.children].forEach((child, i) =>
		tl.to(child, { opacity: i === index ? 1 : 0 }, at, { dur }),
	);
}

function swapBadge<K extends string>(
	tl: Timeline,
	badges: Record<K, HTMLElement>,
	show: K,
	at: number,
): void {
	for (const [name, badge] of Object.entries(badges) as [K, HTMLElement][]) {
		tl.to(badge, { opacity: name === show ? 1 : 0 }, at, { dur: 0.25 });
	}
}

/**
 * Reveals or covers the stage with `card`, wiping upwards with a line along
 * the edge. A wipe only changes a strip of each frame, unlike a fade.
 */
function wipe(
	tl: Timeline,
	card: HTMLElement,
	edge: HTMLElement,
	direction: "in" | "out",
	at: number,
): void {
	const dur = 0.6;
	const options = { dur, ease: ease.inOut };
	tl.keyframes(
		card,
		direction === "out"
			? [{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 0 100% 0)" }]
			: [{ clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0 0 0 0)" }],
		at,
		options,
	);
	tl.set(edge, { opacity: 1 }, at);
	tl.keyframes(edge, [{ top: "100%" }, { top: "0%" }], at, options);
	tl.set(edge, { opacity: 0 }, at + dur);
}

/** A marker running down the step's gutter, as a run executes its lines. */
function sweep(
	tl: Timeline,
	bar: HTMLElement,
	at: number,
	from: number,
	to: number,
	dur = 0.45,
	stop = false,
): void {
	const top = (row: number) => `${6 + row * 20}px`;
	tl.set(bar, { top: top(from), opacity: 1 }, at);
	tl.to(bar, { top: top(to) }, at, { dur, ease: ease.linear });
	tl.set(bar, { opacity: 0 }, at + dur + (stop ? 0.1 : 0.05));
}

/** Text that may wrap after each slash, like a long path. */
function breakable(text: string): (string | HTMLElement)[] {
	return text
		.split("/")
		.flatMap((part, index) => (index ? ["/", h("wbr"), part] : [part]));
}

function fileRow(path: string, change: string): HTMLElement {
	return h(
		"div.file-row",
		icon("file"),
		h("span.path", ...breakable(path)),
		h(
			"span.stat",
			...change
				.split(" ")
				.map((part) =>
					h(part.startsWith("+") ? "span.green" : "span.red", `${part} `),
				),
		),
	);
}
