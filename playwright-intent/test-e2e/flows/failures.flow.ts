import { expect, flow } from "../harness/flow";
import {
	CHECKOUT_TEST,
	CODE,
	checkoutScript,
	INTENT,
} from "../harness/shop-steps";
import type { Project } from "../harness/project";

const FIXED_ADD = CODE.add.replace("Add blue shirt", "Buy blue shirt");
const FOLDER = "tests/checkout.spec.ts/checkout - guest buys a shirt";

async function generateCheckout(project: Project) {
	await project.scriptAgent(checkoutScript());
	await project.run({ mode: "missing" });
}

/**
 * The agreed failure design, written first. In `changed` mode the agent
 * diagnoses each failure on the live page. Flows check the decision is applied
 * and that the limits hold, whatever the agent asks for.
 */
flow.describe("failures in changed mode", () => {
	flow.fixme(
		"repair on an unchanged page continues the same attempt",
		async ({ project }) => {
			await generateCheckout(project);
			await project.scriptAgent({
				diagnose: {
					[INTENT.add]: [
						{
							explore: [FIXED_ADD],
							decision: { action: "repair", code: FIXED_ADD, page: "ready" },
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
			expect(await project.readStep(`${FOLDER}/${INTENT.add}.ts`)).toContain(
				"Buy blue shirt",
			);
		},
	);

	flow.fixme(
		"a ready repair on a changed page is treated as dirty",
		async ({ project }) => {
			await generateCheckout(project);
			await project.scriptAgent({
				diagnose: {
					[INTENT.add]: [
						{
							explore: ['await page.goto("/cart");'],
							decision: { action: "repair", code: FIXED_ADD, page: "ready" },
						},
					],
				},
			});

			const run = await project.run({
				mode: "changed",
				shop: "renamed-add-link",
				retries: 1,
			});

			expect(run.test(CHECKOUT_TEST).attempts).toEqual(["failed", "passed"]);
		},
	);

	flow.fixme(
		"regenerate moves named steps aside and redoes them",
		async ({ project }) => {
			await generateCheckout(project);
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
				generate: checkoutScript().generate,
			});

			const run = await project.run({
				mode: "changed",
				shop: "redesigned",
				retries: 1,
			});

			const regenerated = (await project.agentCalls()).filter(
				(call) => call.kind === "generate",
			);
			expect(regenerated.at(-1)?.task).toHaveProperty("previousFailure");
			expect(run.test(CHECKOUT_TEST).attempts).toHaveLength(2);
		},
	);

	flow.fixme(
		"regenerate can't touch another test's steps",
		async ({ project }) => {
			await generateCheckout(project);
		},
	);

	flow.fixme(
		"rerun leaves the cache alone and fails the attempt",
		async ({ project }) => {
			await generateCheckout(project);
			const stepsBefore = await project.stepFiles();
			await project.scriptAgent({
				diagnose: {
					[INTENT.add]: [
						{ decision: { action: "rerun", reason: "Looks like a one-off." } },
					],
				},
			});

			const run = await project.run({
				mode: "changed",
				shop: "renamed-add-link",
			});

			expect(run.exitCode).toBe(1);
			expect(await project.stepFiles()).toEqual(stepsBefore);
		},
	);

	flow.fixme(
		"fail reports the diagnosis and leaves the cache alone",
		async ({ project }) => {
			await generateCheckout(project);
			await project.scriptAgent({
				diagnose: {
					[INTENT.pay]: [
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

			expect(run.output).toContain("Payment is really broken.");
		},
	);

	flow.fixme(
		"a hand-written failure can't repair, but can regenerate",
		async ({ project }) => {
			await generateCheckout(project);
			await project.scriptAgent({
				diagnose: {
					outside: [
						{ decision: { action: "regenerate", steps: [INTENT.pay] } },
					],
				},
			});

			await project.run({ mode: "changed", shop: "broken-payment" });

			const [diagnosis] = (await project.agentCalls()).filter(
				(call) => call.kind === "diagnose",
			);
			expect(diagnosis?.task).toMatchObject({ location: "outside" });
		},
	);

	flow.fixme(
		"use.intent.context reaches the diagnosis",
		async ({ project }) => {
			await generateCheckout(project);
		},
	);

	flow.fixme(
		"a repair that edits an assertion is listed for review",
		async ({ project }) => {
			await generateCheckout(project);
		},
	);

	flow.fixme(
		"retries cap a diagnosis that never converges",
		async ({ project }) => {
			await generateCheckout(project);
		},
	);

	flow.fixme(
		"a timeout outside a step still gets a diagnosis",
		async ({ project }) => {
			await generateCheckout(project);
		},
	);
});
