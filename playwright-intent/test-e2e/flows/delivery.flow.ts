import { expect, flow } from "../harness/flow";
import type { Project } from "../harness/project";
import {
	CHECKOUT_TEST,
	CODE,
	checkoutScript,
	INTENT,
	solved,
	solvedButDirty,
} from "../harness/shop-steps";

const FIXED_ADD = CODE.add.replace("Add blue shirt", "Buy blue shirt");
const FOLDER = "tests/checkout.spec.ts/checkout - guest buys a shirt";
const ADD_FILE = `${FOLDER}/${INTENT.add}.ts`;
const CHECKOUT_FILE = `${FOLDER}/${INTENT.checkout}.ts`;
const PAY_FILE = `${FOLDER}/${INTENT.pay}.ts`;
const REASON = "The link was renamed.";

function repairAdd() {
	return {
		explore: [FIXED_ADD],
		decision: {
			action: "repair" as const,
			code: FIXED_ADD,
			page: "ready" as const,
			reason: REASON,
		},
	};
}

async function generateCheckout(project: Project) {
	await project.scriptAgent(checkoutScript());
	await project.run();
}

/** A one-step spec, for runs that need more than one test to break. */
async function addSpec(project: Project, file: string, intent: string) {
	await project.writeFile(
		`tests/${file}`,
		`import { test } from "./fixtures";

test("${intent}", async ({ page, ai }) => {
	await page.goto("/");
	await ai.do("${intent}");
});
`,
	);
}

flow.describe("commit and propose", () => {
	flow("commit carries on after a ready fix", async ({ project }) => {
		await generateCheckout(project);
		await project.scriptAgent({ diagnose: { [INTENT.add]: [repairAdd()] } });

		const run = await project.run({
			shop: "renamed-add-link",
			updates: "commit",
		});

		const test = run.test(CHECKOUT_TEST);
		expect(run.exitCode).toBe(0);
		expect(test.outcome).toBe("expected");
		expect(test.attempts).toEqual(["passed"]);
		expect(test.changes).toEqual([
			{
				attempt: 0,
				version: 2,
				kind: "write",
				key: ADD_FILE,
				cause: "repair",
				reason: REASON,
				source: expect.stringContaining("Buy blue shirt"),
			},
		]);
		expect(run.reported.passed).toMatchObject([
			{ key: ADD_FILE, kind: "write" },
		]);
		expect(run.output).toContain("Step changes from passing tests (1)");
	});

	flow("commit retries after a dirty fix", async ({ project }) => {
		await generateCheckout(project);
		const repair = repairAdd();
		await project.scriptAgent({
			diagnose: {
				[INTENT.add]: [
					{ ...repair, decision: { ...repair.decision, page: "dirty" } },
				],
			},
		});

		const run = await project.run({
			shop: "renamed-add-link",
			retries: 1,
			updates: "commit",
		});

		const test = run.test(CHECKOUT_TEST);
		expect(run.exitCode).toBe(0);
		expect(test.outcome).toBe("flaky");
		expect(test.attempts).toEqual(["failed", "passed"]);
		expect(run.reported.passed).toHaveLength(1);
	});

	flow("propose stays red once the fix passes", async ({ project }) => {
		await generateCheckout(project);
		await project.scriptAgent({ diagnose: { [INTENT.add]: [repairAdd()] } });

		const run = await project.run({
			shop: "renamed-add-link",
			updates: "propose",
		});

		const test = run.test(CHECKOUT_TEST);
		expect(run.exitCode).toBe(1);
		expect(test.outcome).toBe("unexpected");
		expect(test.attempts).toEqual(["failed"]);
		expect(test.errors[0]).toContain("The test passed with its step changes");
		expect(test.changes).toMatchObject([{ attempt: 0, key: ADD_FILE }]);
		expect(run.reported.passed).toMatchObject([{ key: ADD_FILE }]);
	});

	flow("propose keeps failing on every retry left", async ({ project }) => {
		await generateCheckout(project);
		await project.scriptAgent({ diagnose: { [INTENT.add]: [repairAdd()] } });

		const run = await project.run({
			shop: "renamed-add-link",
			retries: 2,
			updates: "propose",
		});

		expect(run.test(CHECKOUT_TEST).attempts).toEqual([
			"failed",
			"failed",
			"failed",
		]);
		expect(run.test(CHECKOUT_TEST).errors[2]).toContain(
			"The test passed with its step changes",
		);
		// Later attempts fail before the test starts, so they record no trace steps.
		expect(run.test(CHECKOUT_TEST).notes).toHaveLength(1);
		expect(run.reported.passed).toHaveLength(1);
	});

	flow(
		"propose leaves a flaky test that changed nothing alone",
		async ({ project }) => {
			await generateCheckout(project);
			await project.replaceInFile(
				"tests/checkout.spec.ts",
				'await page.goto("/");',
				'await page.goto("/");\n\t\tif (test.info().retry === 0) throw new Error("A flake");',
			);

			const run = await project.run({ retries: 1, updates: "propose" });

			expect(run.exitCode).toBe(0);
			expect(run.test(CHECKOUT_TEST).outcome).toBe("flaky");
			expect(run.test(CHECKOUT_TEST).changes).toEqual([]);
		},
	);

	flow(
		"several generated steps can land in one attempt",
		async ({ project }) => {
			await project.scriptAgent(checkoutScript());

			const run = await project.run({ updates: "commit" });

			const test = run.test(CHECKOUT_TEST);
			expect(test.attempts).toEqual(["passed"]);
			expect(test.changes).toMatchObject([
				{ attempt: 0, key: ADD_FILE, cause: "generate" },
				{ attempt: 0, key: CHECKOUT_FILE, cause: "generate" },
				{ attempt: 0, key: PAY_FILE, cause: "generate" },
			]);
			expect(run.reported.passed).toHaveLength(3);
		},
	);

	flow("a regenerated step is delivered as one change", async ({ project }) => {
		const script = checkoutScript();
		await project.scriptAgent(script);
		await project.run();
		script.generate[INTENT.add]?.push(solved(FIXED_ADD));
		await project.scriptAgent({
			...script,
			diagnose: {
				[INTENT.add]: [
					{
						decision: {
							action: "regenerate",
							steps: [INTENT.add],
							reason: REASON,
						},
					},
				],
			},
		});

		const run = await project.run({
			shop: "renamed-add-link",
			retries: 1,
			updates: "commit",
		});

		expect(run.test(CHECKOUT_TEST).changes).toMatchObject([
			{ attempt: 0, kind: "delete", key: ADD_FILE, cause: "regenerate" },
			{ attempt: 1, kind: "write", key: ADD_FILE, cause: "generate" },
		]);
		expect(run.reported.passed).toMatchObject([
			{ key: ADD_FILE, kind: "write", cause: "regenerate", reason: REASON },
		]);
	});

	flow("a real bug is recorded as a diagnosis", async ({ project }) => {
		await generateCheckout(project);
		await project.scriptAgent({
			diagnose: {
				outside: [
					{ decision: { action: "fail", reason: "Payments are down." } },
				],
			},
		});

		const run = await project.run({
			shop: "broken-payment",
			retries: 1,
			updates: "commit",
		});

		const test = run.test(CHECKOUT_TEST);
		expect(run.exitCode).toBe(1);
		expect(test.changes).toEqual([
			{
				attempt: 0,
				version: 2,
				kind: "diagnosis",
				reason: "Payments are down.",
			},
		]);
		const set = run.reported;
		expect(set.passed).toEqual([]);
		expect(set.diagnoses).toMatchObject([{ reason: "Payments are down." }]);
	});

	flow("a change whose test never passes is left out", async ({ project }) => {
		await project.scriptAgent({
			generate: { [INTENT.add]: [solvedButDirty(CODE.add)] },
		});

		const run = await project.run({ updates: "commit" });

		expect(run.test(CHECKOUT_TEST).attempts).toEqual(["failed"]);
		const set = run.reported;
		expect(set.passed).toEqual([]);
		expect(set.failed).toMatchObject([{ key: ADD_FILE }]);
		expect(run.output).toContain(
			"Step changes from failing tests, left out (1)",
		);
	});

	for (const updates of ["allow", "refuse"] as const) {
		flow(`${updates} attaches no records`, async ({ project }) => {
			await generateCheckout(project);
			await project.scriptAgent({ diagnose: { [INTENT.add]: [repairAdd()] } });

			const run = await project.run({
				shop: "renamed-add-link",
				retries: 1,
				updates,
			});

			expect(run.test(CHECKOUT_TEST).attachments).not.toContain(
				"intent-change",
			);
			expect(run.reported).toEqual({
				passed: [],
				failed: [],
				diagnoses: [],
			});
			expect(run.output).not.toContain("Step changes");
		});
	}

	flow(
		"merge-reports combines shards into one set of changes",
		async ({ project }) => {
			const second = "put the blue shirt in the cart";
			const third = "grab the blue shirt";
			await addSpec(project, "second.spec.ts", second);
			await addSpec(project, "third.spec.ts", third);
			const files = [
				"tests/checkout.spec.ts",
				"tests/second.spec.ts",
				"tests/third.spec.ts",
			];
			const baseline = checkoutScript().generate;
			await project.scriptAgent({
				generate: {
					...baseline,
					[second]: [solved(CODE.add)],
					[third]: [solved(CODE.add)],
				},
			});
			await project.run({ files });
			const stillBroken = CODE.add;
			await project.scriptAgent({
				diagnose: {
					[INTENT.add]: [repairAdd()],
					[second]: [repairAdd()],
					[third]: [
						{
							decision: { action: "repair", code: stillBroken, page: "dirty" },
						},
					],
				},
			});

			const options = {
				shop: "renamed-add-link",
				retries: 1,
				updates: "commit",
				files,
			} as const;
			await project.run({ ...options, shard: "1/2" });
			await project.run({ ...options, shard: "2/2" });
			const merged = await project.mergeReports({ updates: "commit" });

			const set = merged.reported;
			expect(set.passed.map((change) => change.key)).toEqual([
				ADD_FILE,
				`tests/second.spec.ts/${second}/${second}.ts`,
			]);
			expect(set.failed.map((change) => change.key)).toEqual([
				`tests/third.spec.ts/${third}/${third}.ts`,
			]);
			expect(merged.test(CHECKOUT_TEST).changes).toHaveLength(1);
			expect(merged.output).toContain("Step changes from passing tests (2)");
			expect(merged.output).toContain(
				"Step changes from failing tests, left out (1)",
			);
		},
	);
});
