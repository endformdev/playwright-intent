import { expect, flow } from "../harness/flow";
import { CHECKOUT_TEST, checkoutScript } from "../harness/shop-steps";

flow.describe("project setups", () => {
	flow(
		"a CommonJS project generates and replays",
		async ({ createProject }) => {
			const project = await createProject({ moduleType: "cjs" });
			await project.scriptAgent(checkoutScript());

			const generated = await project.run();
			const replayed = await project.run();

			expect(generated.exitCode).toBe(0);
			expect(replayed.exitCode).toBe(0);
			const calls = await project.agentCalls();
			expect(calls.map((call) => call.task.testFile.line)).toEqual([7, 8, 9]);
		},
	);

	flow(
		"a remote store fills .intent during the run",
		async ({ createProject }) => {
			const project = await createProject({ remoteStore: true });
			await project.scriptAgent(checkoutScript());
			await project.run();
			await project.clearLocalSteps();
			expect(await project.stepFiles()).toEqual([]);

			const replay = await project.run();

			expect(replay.exitCode).toBe(0);
			expect(replay.test(CHECKOUT_TEST).attempts).toEqual(["passed"]);
			expect(await project.stepFiles()).toEqual(await project.remoteFiles());
		},
	);
});
