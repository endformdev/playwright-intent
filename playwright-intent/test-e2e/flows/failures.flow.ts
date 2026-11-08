import { expect, flow } from "../harness/flow";
import type { Project } from "../harness/project";
import {
	CHECKOUT_TEST,
	CODE,
	checkoutScript,
	INTENT,
	solved,
} from "../harness/shop-steps";

const FIXED_ADD = CODE.add.replace("Add blue shirt", "Buy blue shirt");
const FOLDER = "tests/checkout.spec.ts/checkout - guest buys a shirt";
const ADD_FILE = `${FOLDER}/${INTENT.add}.ts`;
const CHECKOUT_FILE = `${FOLDER}/${INTENT.checkout}.ts`;
const PAY_FILE = `${FOLDER}/${INTENT.pay}.ts`;

/** Clicks, so the page moves on, then fails. */
const FAILS_AFTER_CLICKING = `${CODE.add}
await expect(page.getByRole("heading", { name: "Never here" })).toBeVisible();`;

async function generateCheckout(project: Project) {
	await project.scriptAgent(checkoutScript());
	await project.run({ mode: "missing" });
}

/** Generates the checkout, with one step saved as `code` instead. */
async function generateWithStep(
	project: Project,
	intent: string,
	code: string,
	explored = CODE.add,
) {
	const script = checkoutScript();
	script.generate[intent] = [
		{
			explore: [explored],
			outcome: { status: "solved", code, page: "ready" },
		},
	];
	await project.scriptAgent(script);
	await project.run({ mode: "missing" });
}

async function diagnoses(project: Project) {
	const calls = await project.agentCalls();
	return calls.filter((call) => call.kind === "diagnose");
}

/**
 * In `changed` mode the agent diagnoses each failure on the live page. Flows
 * check the decision is applied and that the limits hold, whatever it asks for.
 */
flow.describe("failures in changed mode", () => {
	flow(
		"repair on an unchanged page continues the same attempt",
		async ({ project }) => {
			await generateCheckout(project);
			await project.scriptAgent({
				diagnose: {
					[INTENT.add]: [
						{
							explore: [FIXED_ADD],
							decision: {
								action: "repair",
								code: FIXED_ADD,
								page: "ready",
								reason: "The link was renamed.",
							},
						},
					],
				},
			});

			const run = await project.run({
				mode: "changed",
				shop: "renamed-add-link",
			});

			expect(run.exitCode).toBe(0);
			expect(run.test(CHECKOUT_TEST).attempts).toEqual(["passed"]);
			expect(run.test(CHECKOUT_TEST).notes[0]).toContain(
				"The link was renamed.",
			);
			expect(await project.readStep(ADD_FILE)).toContain("Buy blue shirt");
		},
	);

	flow("the agent is told what failed", async ({ project }) => {
		await generateCheckout(project);
		await project.scriptAgent({
			diagnose: {
				[INTENT.add]: [{ decision: { action: "fail", reason: "Checked." } }],
			},
		});

		await project.run({ mode: "changed", shop: "renamed-add-link" });

		const [call] = await diagnoses(project);
		expect(call?.task).toMatchObject({
			location: "step",
			pageUnchanged: true,
			code: CODE.add,
		});
		expect(call?.task).toHaveProperty(
			"testFile.path",
			"tests/checkout.spec.ts",
		);
		expect(JSON.stringify(call?.task)).toContain("Timeout 1000ms");
	});

	flow(
		"a ready repair after the step changed the page is treated as dirty",
		async ({ project }) => {
			await generateWithStep(project, INTENT.add, FAILS_AFTER_CLICKING);
			await project.scriptAgent({
				diagnose: {
					[INTENT.add]: [
						{
							decision: { action: "repair", code: CODE.add, page: "ready" },
						},
					],
				},
			});

			const run = await project.run({ mode: "changed", retries: 1 });

			expect((await diagnoses(project))[0]?.task).toMatchObject({
				pageUnchanged: false,
			});
			expect(run.test(CHECKOUT_TEST).attempts).toEqual(["failed", "passed"]);
			expect(run.exitCode).toBe(0);
		},
	);

	flow("a dirty repair saves the code for a retry", async ({ project }) => {
		await generateCheckout(project);
		await project.scriptAgent({
			diagnose: {
				[INTENT.add]: [
					{ decision: { action: "repair", code: FIXED_ADD, page: "dirty" } },
				],
			},
		});

		const run = await project.run({
			mode: "changed",
			shop: "renamed-add-link",
		});
		const nextRun = await project.run({
			mode: "none",
			shop: "renamed-add-link",
		});

		expect(run.exitCode).toBe(1);
		expect(run.test(CHECKOUT_TEST).errors[0]).toContain("Saved a repair");
		expect(nextRun.exitCode).toBe(0);
	});

	flow(
		"regenerate deletes named steps and redoes them",
		async ({ project }) => {
			const broken = CODE.checkout.replace(
				'"Checkout" }).click',
				'"No" }).click',
			);
			await generateWithStep(project, INTENT.checkout, broken, CODE.checkout);
			await project.scriptAgent({
				diagnose: {
					[INTENT.checkout]: [
						{
							decision: {
								action: "regenerate",
								steps: [INTENT.add, INTENT.checkout],
							},
						},
					],
				},
				generate: {
					[INTENT.add]: [solved(CODE.add), solved(CODE.add)],
					[INTENT.checkout]: [solved(broken), solved(CODE.checkout)],
				},
			});

			const run = await project.run({ mode: "changed", retries: 1 });

			expect(run.test(CHECKOUT_TEST).attempts).toEqual(["failed", "passed"]);
			expect(await project.stepFiles()).toEqual([
				ADD_FILE,
				CHECKOUT_FILE,
				PAY_FILE,
			]);
			expect(await project.readStep(CHECKOUT_FILE)).toContain(
				'"Checkout" }).click',
			);
		},
	);

	flow(
		"regenerate continues on the next run when retries run out",
		async ({ project }) => {
			await generateCheckout(project);
			await project.scriptAgent({
				diagnose: {
					[INTENT.add]: [
						{ decision: { action: "regenerate", steps: [INTENT.add] } },
					],
				},
				generate: { [INTENT.add]: [solved(FIXED_ADD), solved(FIXED_ADD)] },
			});

			const failed = await project.run({
				mode: "changed",
				shop: "renamed-add-link",
			});
			const remaining = await project.stepFiles();
			const passed = await project.run({
				mode: "changed",
				shop: "renamed-add-link",
			});

			expect(failed.exitCode).toBe(1);
			expect(remaining).toEqual([CHECKOUT_FILE, PAY_FILE]);
			expect(passed.exitCode).toBe(0);
			expect(await project.stepFiles()).toEqual([
				ADD_FILE,
				CHECKOUT_FILE,
				PAY_FILE,
			]);
		},
	);

	flow("regenerate can't touch another test's steps", async ({ project }) => {
		await generateCheckout(project);
		const stepsBefore = await project.stepFiles();
		await project.scriptAgent({
			diagnose: {
				[INTENT.add]: [
					{
						decision: {
							action: "regenerate",
							steps: ["a step from elsewhere"],
						},
					},
				],
			},
		});

		const run = await project.run({
			mode: "changed",
			shop: "renamed-add-link",
		});

		expect(run.test(CHECKOUT_TEST).notes[0]).toContain("aren't in this test");
		expect(await project.stepFiles()).toEqual(stepsBefore);
	});

	flow(
		"fail keeps the step's own error and leaves the cache alone",
		async ({ project }) => {
			await generateCheckout(project);
			const stepsBefore = await project.stepFiles();
			await project.scriptAgent({
				diagnose: {
					[INTENT.add]: [
						{ decision: { action: "fail", reason: "Looks like a one-off." } },
					],
				},
			});

			const run = await project.run({
				mode: "changed",
				shop: "renamed-add-link",
			});

			expect(run.exitCode).toBe(1);
			expect(run.test(CHECKOUT_TEST).errors[0]).toContain("Timeout 1000ms");
			expect(await project.stepFiles()).toEqual(stepsBefore);
		},
	);

	flow(
		"fail reports the diagnosis and leaves the cache alone",
		async ({ project }) => {
			await generateCheckout(project);
			const stepsBefore = await project.stepFiles();
			await project.scriptAgent({
				diagnose: {
					outside: [
						{
							decision: { action: "fail", reason: "Payment is really broken." },
						},
					],
				},
			});

			const run = await project.run({
				mode: "changed",
				shop: "broken-payment",
			});

			expect(run.exitCode).toBe(1);
			expect(run.test(CHECKOUT_TEST).notes[0]).toContain(
				"Payment is really broken.",
			);
			expect(await project.stepFiles()).toEqual(stepsBefore);
		},
	);

	flow(
		"a hand-written failure can't repair, but can regenerate",
		async ({ project }) => {
			await generateCheckout(project);
			await project.scriptAgent({
				diagnose: {
					outside: [
						{ decision: { action: "repair", code: "", page: "ready" } },
						{ decision: { action: "regenerate", steps: [INTENT.pay] } },
					],
				},
			});

			const refused = await project.run({
				mode: "changed",
				shop: "broken-payment",
			});
			await project.run({ mode: "changed", shop: "broken-payment" });

			const [diagnosis] = await diagnoses(project);
			expect(diagnosis?.task).toMatchObject({ location: "outside" });
			expect(JSON.stringify(diagnosis?.task)).toContain(CODE.pay.slice(0, 20));
			expect(refused.test(CHECKOUT_TEST).notes[0]).toContain("can't repair");
			expect(await project.stepFiles()).toEqual([ADD_FILE, CHECKOUT_FILE]);
		},
	);

	flow("use.intent.context reaches the diagnosis", async ({ project }) => {
		await generateCheckout(project);
		await project.scriptAgent({
			diagnose: {
				[INTENT.add]: [{ decision: { action: "fail", reason: "Checked." } }],
			},
		});

		await project.run({
			mode: "changed",
			shop: "renamed-add-link",
			failureContext: "This test failed 4 times this week.",
		});

		expect((await diagnoses(project))[0]?.task).toMatchObject({
			extraContext: "This test failed 4 times this week.",
		});
	});

	flow(
		"a repair that edits an assertion is listed for review",
		async ({ project }) => {
			await generateCheckout(project);
			const looser = FIXED_ADD.replace('"Your cart"', "/cart/i");
			await project.scriptAgent({
				diagnose: {
					[INTENT.add]: [
						{
							explore: [looser],
							decision: { action: "repair", code: looser, page: "ready" },
						},
					],
				},
			});

			const run = await project.run({
				mode: "changed",
				shop: "renamed-add-link",
			});

			const notes = run.test(CHECKOUT_TEST).notes.join("\n");
			expect(notes).toContain("Check these assertion changes");
			expect(notes).toContain('- await expect(page.getByRole("heading"');
			expect(notes).toContain("/cart/i");
		},
	);

	flow("retries cap a diagnosis that never converges", async ({ project }) => {
		await generateCheckout(project);
		const regenerate = (step: string) => ({
			decision: { action: "regenerate" as const, steps: [step] },
		});
		await project.scriptAgent({
			diagnose: {
				[INTENT.add]: [regenerate(INTENT.add)],
				[INTENT.checkout]: [regenerate(INTENT.checkout)],
			},
			generate: {
				[INTENT.add]: [
					solved(CODE.add),
					{
						explore: [],
						outcome: { status: "solved", code: CODE.add, page: "ready" },
					},
				],
			},
		});

		const run = await project.run({
			mode: "changed",
			shop: "renamed-add-link",
			retries: 1,
		});

		expect(run.test(CHECKOUT_TEST).attempts).toEqual(["failed", "failed"]);
		expect(run.exitCode).toBe(1);
	});

	flow(
		"a timeout outside a step still gets a diagnosis",
		async ({ project }) => {
			await generateCheckout(project);
			await project.scriptAgent({
				diagnose: {
					outside: [{ decision: { action: "fail", reason: "It hung." } }],
				},
			});
			await project.replaceInFile(
				"tests/checkout.spec.ts",
				'await ai.do("pay as {email}", { email: "guest@example.com" });',
				`await ai.do("pay as {email}", { email: "guest@example.com" });
		await new Promise(() => {});`,
			);

			const run = await project.run({ mode: "changed", timeout: 3_000 });

			expect(run.test(CHECKOUT_TEST).attempts).toEqual(["timedOut"]);
			expect(run.test(CHECKOUT_TEST).notes[0]).toContain("It hung.");
		},
	);

	flow(
		"a timeout inside a step can repair it for the retry",
		async ({ project }) => {
			await generateWithStep(
				project,
				INTENT.add,
				"await new Promise(() => {});",
			);
			await project.scriptAgent({
				diagnose: {
					[INTENT.add]: [
						{ decision: { action: "repair", code: CODE.add, page: "ready" } },
					],
				},
			});

			const run = await project.run({
				mode: "changed",
				timeout: 3_000,
				retries: 1,
			});

			expect((await diagnoses(project))[0]?.task).toMatchObject({
				location: "step",
			});
			expect(run.test(CHECKOUT_TEST).attempts).toEqual(["timedOut", "passed"]);
		},
	);

	flow("a step that won't load gets a diagnosis", async ({ project }) => {
		await generateCheckout(project);
		const source = await project.readStep(ADD_FILE);
		await project.writeStep(ADD_FILE, source.replace("await page", "await ("));
		await project.scriptAgent({
			diagnose: {
				[INTENT.add]: [
					{
						explore: [CODE.add],
						decision: { action: "repair", code: CODE.add, page: "ready" },
					},
				],
			},
		});

		const run = await project.run({ mode: "changed" });

		expect(run.exitCode).toBe(0);
		expect(run.test(CHECKOUT_TEST).attempts).toEqual(["passed"]);
	});

	flow("a failed diagnosis keeps the test's own error", async ({ project }) => {
		await generateCheckout(project);
		await project.scriptAgent({});

		const run = await project.run({
			mode: "changed",
			shop: "renamed-add-link",
		});

		const summary = run.test(CHECKOUT_TEST);
		expect(summary.errors[0]).toContain("Timeout 1000ms");
		expect(summary.notes[0]).toContain("The diagnosis failed");
	});

	flow("without an agent, the test just fails", async ({ project }) => {
		await generateCheckout(project);

		const run = await project.run({
			mode: "changed",
			shop: "renamed-add-link",
			withoutAgent: true,
		});

		expect(run.test(CHECKOUT_TEST).errors[0]).toContain("Timeout 1000ms");
		expect(await project.agentCalls()).toHaveLength(3);
	});

	flow("a passing test is never diagnosed", async ({ project }) => {
		await generateCheckout(project);
		await project.scriptAgent({});

		const run = await project.run({ mode: "changed" });

		expect(run.exitCode).toBe(0);
		expect(await diagnoses(project)).toEqual([]);
	});
});
