import { expect, flow } from "../harness/flow";
import {
	CHECKOUT_TEST,
	checkoutScript,
	INTENT,
	STEP_FILE,
} from "../harness/shop-steps";

flow.describe("traces and errors", () => {
	flow("a replayed step shows real lines in the trace", async ({ project }) => {
		await project.scriptAgent(checkoutScript());
		await project.run();
		const source = await project.readStep(STEP_FILE.add);
		const clickLine = lineContaining(source, "Add blue shirt");

		const replay = await project.run();

		const { actions, sources } = replay.test(CHECKOUT_TEST).trace();
		expect(actions).toContainEqual(
			expect.objectContaining({
				file: "add-the-blue-shirt-to-the-cart.ts",
				line: clickLine,
			}),
		);
		expect(sources).toContain(source);
	});

	flow("a stale step reports the exact failing line", async ({ project }) => {
		await project.scriptAgent(checkoutScript());
		await project.run();
		const source = await project.readStep(STEP_FILE.add);

		const run = await project.run({ ci: true, shop: "renamed-add-link" });

		const [snippet] = run.test(CHECKOUT_TEST).snippets;
		expect(snippet).toContain(
			`> ${lineContaining(source, "Add blue shirt")} |`,
		);
		expect(snippet).toContain("Add blue shirt");
	});

	flow("an ai.do step points at the user's own test", async ({ project }) => {
		await project.scriptAgent(checkoutScript());
		await project.run();

		const replay = await project.run();

		const { actions } = replay.test(CHECKOUT_TEST).trace();
		expect(actions).toContainEqual(
			expect.objectContaining({
				title: `ai: ${INTENT.add}`,
				file: "checkout.spec.ts",
			}),
		);
	});
});

function lineContaining(source: string, text: string): number {
	return source.split("\n").findIndex((line) => line.includes(text)) + 1;
}
