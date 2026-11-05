import { IntentNotImplementedError } from "../errors";
import type { TestScope } from "../fixture/test-scope";
import type { StepContext } from "./run-step";

export interface StepFailure {
	key: string;
	intent: string;
	error: unknown;
	/** The ARIA snapshot from before the step ran. */
	before: string | null;
}

/**
 * Runs in `changed` mode, on the live page, after a cached step fails.
 *
 * Planned flow:
 * 1. Compare `before` with the page now, and read `use.intent.context`.
 * 2. Ask `agent.diagnose` for a `FailureDecision`.
 * 3. Apply it, enforcing the limits in code:
 *    - `repair` + `ready`: only with an unchanged page, otherwise treat it as
 *      `dirty`. Save, then let the test continue.
 *    - `repair` + `dirty`: save, then throw `IntentRewindError`.
 *    - `regenerate`: move this test's named steps to `.intent/.failed`, then
 *      throw `IntentRewindError`.
 *    - `rerun` and `fail`: rethrow the original error.
 */
export async function handleStepFailure(
	_scope: TestScope,
	_context: StepContext,
	_failure: StepFailure,
): Promise<void> {
	throw new IntentNotImplementedError(
		"`changed` mode can't diagnose failures yet.",
	);
}
