import type { Page, test as base } from "@playwright/test";
import { registerStepLoader } from "../loader/step-loader";
import type { IntentUseOptions } from "../options";
import type { StepVariables } from "../step/intent-text";
import { runStep } from "../step/run-step";
import { callLineIn } from "./test-file";
import { createTestScope } from "./test-scope";

export interface IntentActions {
	/**
	 * Carries out a natural-language step.
	 *
	 * @param intent What should happen. Use `{name}` for anything that varies.
	 * @param vars A value for each placeholder. The model gets the names, but
	 *   sees any value written in the test file.
	 */
	do(intent: string, vars?: StepVariables): Promise<void>;
}

/** `ai.do(...)` uses the test's page, and `ai(page).do(...)` picks another. */
export interface Ai extends IntentActions {
	(page: Page): IntentActions;
}

export interface IntentFixtures {
	ai: Ai;
}

/** Adds the `ai` fixture to any test, so it composes with `mergeTests`. */
export function createIntentTest<T extends typeof base>(testBase: T) {
	registerStepLoader();

	return testBase.extend<IntentUseOptions & IntentFixtures>({
		intent: [undefined, { option: true }],

		ai: async (
			{ page, request, intent, actionTimeout, testIdAttribute },
			use,
			testInfo,
		) => {
			const scope = createTestScope(intent, testInfo, request, {
				actionTimeout,
				testIdAttribute,
			});

			const actionsFor = (target: Page): IntentActions => ({
				do: (text, vars = {}) => {
					const line = callLineIn(testInfo.file);
					return testBase.step(`ai: ${text}`, () =>
						runStep(scope, target, text, vars, line),
					);
				},
			});

			const ai = Object.assign(actionsFor, actionsFor(page));
			await use(ai);

			// Planned: in `changed` mode, if the test failed outside any step,
			// diagnose here while the page is still alive. See handle-failure.ts.
		},
	});
}
