/**
 * The boundary between this library and whatever makes decisions.
 *
 * The library owns the browser, the cache and the safety limits. An agent only
 * observes, runs code through its session, and returns one outcome. The
 * built-in AI SDK agent, the scripted e2e agent and any future external agent
 * all implement this same interface.
 */
export interface IntentAgent {
	/** A step has no code yet. The session is on the page before the step. */
	generate(task: GenerateTask, session: AgentSession): Promise<GenerateOutcome>;
	/** Something failed. The session is on the live, failed page. */
	diagnose(task: DiagnoseTask, session: AgentSession): Promise<FailureDecision>;
}

export interface AgentSession {
	observe(): Promise<Observation>;
	/**
	 * Runs Playwright statements in the test's scope. Use it freely: logging
	 * and experiments here never become part of the saved step.
	 */
	run(code: string): Promise<RunResult>;
}

export interface Observation {
	url: string;
	title: string;
	/** `page.ariaSnapshot({ mode: "ai" })`, or null if it couldn't be taken. */
	ariaSnapshot: string | null;
	screenshot: Buffer | null;
	console: string[];
	pageErrors: string[];
}

export interface RunResult {
	ok: boolean;
	/** The value of a `return` in the code, as a string. */
	value?: string;
	error?: string;
	/** `console` output from the code, not from the page. */
	logs: string[];
	observation: Observation;
}

/**
 * The test as it is on disk, so the agent can see the hand-written code around
 * a step. It isn't filtered, so anything written in the file reaches the model.
 */
export interface TestFile {
	/** Relative to the Playwright config. */
	path: string;
	source: string;
	/** The line of this `ai.do` call, when it can be found. */
	line?: number;
}

export interface StepTask {
	intent: string;
	testTitle: string;
	testFile: TestFile;
	/** Variable names only. Values passed to `ai.do` aren't sent to the agent. */
	variableNames: string[];
	/** Intents that already ran in this attempt, in order. */
	previousSteps: string[];
	limits: { maxTurns: number; timeoutMs: number };
}

export interface GenerateTask extends StepTask {
	/** Code from an earlier attempt that failed, and why. */
	previousFailure?: { code: string; error: string };
}

export type GenerateOutcome =
	| {
			status: "solved";
			/** Statements for the step file, not including what it explored. */
			code: string;
			/**
			 * `ready`: the page is where this step should leave it.
			 * `dirty`: the code is right, but the page can't continue from here.
			 */
			page: "ready" | "dirty";
	  }
	| { status: "failed"; message: string };

export interface DiagnoseTask extends StepTask {
	/** `outside` means the test failed in hand-written code after the steps. */
	location: "step" | "outside";
	error: string;
	code?: string;
	/** The snapshot from just before the step, and whether it still matches. */
	before?: string | null;
	pageUnchanged: boolean;
	/** Steps already regenerated in this run, to avoid repeating work. */
	regeneratedSteps: string[];
	/** Text returned by `use.intent.context`. */
	extraContext?: string;
}

export type FailureDecision =
	/** Only offered when `location` is `step`. */
	| { action: "repair"; code: string; page: "ready" | "dirty" }
	/** Move these steps from this test aside, and redo them on the retry. */
	| { action: "regenerate"; steps: string[] }
	/** Looks like a one-off. Leave the cache alone. */
	| { action: "rerun"; reason: string }
	/** Looks like a real bug. Leave the cache alone. */
	| { action: "fail"; reason: string };

export interface FailureContextInput {
	testTitle: string;
	intent?: string;
	error: string;
}

export type FailureContextProvider = (
	input: FailureContextInput,
) => string | undefined | Promise<string | undefined>;
