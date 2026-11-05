import { test as base } from "@playwright/test";
import { createIntentTest } from "./fixture/intent-fixture";

export * from "@playwright/test";

export const test = createIntentTest(base);

export type {
	AgentSession,
	DiagnoseTask,
	FailureContextInput,
	FailureContextProvider,
	FailureDecision,
	GenerateOutcome,
	GenerateTask,
	IntentAgent,
	Observation,
	RunResult,
} from "./agent/agent";
export * from "./errors";
export type {
	Ai,
	IntentActions,
	IntentFixtures,
} from "./fixture/intent-fixture";
export { createIntentTest } from "./fixture/intent-fixture";
export type {
	IntentLimits,
	IntentMode,
	IntentOptions,
	IntentUseOptions,
} from "./options";
export type { StepVariables } from "./step/intent-text";
export type { StepContext } from "./step/run-step";
export { createFileStore } from "./store/file-store";
export type { IntentStore } from "./store/store";
