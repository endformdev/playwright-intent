/** Base class, so users and the failure flow can recognise library errors. */
export class IntentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = new.target.name;
	}
}

/** A step has no cached code, and the current mode may not generate it. */
export class IntentStepMissingError extends IntentError {}

/** Two `ai.do` calls in one test sanitize to the same step file. */
export class IntentDuplicateStepError extends IntentError {}

/** A stored step belongs to a different test, or isn't a step file at all. */
export class IntentStepConflictError extends IntentError {}

/** Placeholders and variables passed to `ai.do` don't match. */
export class IntentVariablesError extends IntentError {}

/** The mode needs an agent, but `use.intent` has no `model` or `agent`. */
export class IntentNoAgentError extends IntentError {}

/** The agent finished with `failed`. Nothing was saved. */
export class IntentAgentFailedError extends IntentError {}

/**
 * The cache is ready, but this attempt can't continue from the current page.
 * The test fails on purpose, and the next retry replays from a clean page.
 */
export class IntentRewindError extends IntentError {}

/** Marks parts of the design that are outlined but not built yet. */
export class IntentNotImplementedError extends IntentError {}
