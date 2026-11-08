import { test as base } from "@playwright/test";
import { createIntentTest } from "./fixture/intent-fixture";

export * from "@playwright/test";

export const test = createIntentTest(base);

// The agent types are only exported for this library's e2e scripted agent.
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
export type { IntentPrompts } from "./agent/prompts";
export { defaultPrompts } from "./agent/prompts";
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
export { fileStore } from "./store/file-store";
export type { ChangeHandler, OnChange, StepChange } from "./store/on-change";
export { fail, keep } from "./store/on-change";
export type { IntentStore, IntentStoreProvider } from "./store/store";
