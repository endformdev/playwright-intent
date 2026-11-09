import path from "node:path";
import type { APIRequestContext, TestInfo } from "@playwright/test";
import type { FailureContextProvider, IntentAgent } from "../agent/agent";
import { createAiSdkAgent } from "../agent/ai-sdk-agent";
import type { SessionOptions } from "../agent/session";
import { IntentConfigError } from "../errors";
import {
	DEFAULT_LIMITS,
	type IntentLimits,
	type IntentOptions,
} from "../options";
import type { RunningStep } from "../step/handle-failure";
import { configDirectory, INTENT_DIRECTORY } from "../step/step-path";
import {
	type ChangeDelivery,
	deliveryOf,
	resolveChangePolicy,
	type StepChange,
} from "../store/changes";
import type { IntentStore } from "../store/store";

/** Everything the steps of one test attempt share. */
export interface TestScope {
	/** Null without a model, and under `refuse()`, where no step can change. */
	agent: IntentAgent | null;
	store: IntentStore;
	/** Throws if the `changes` policy doesn't allow this change. */
	checkChange(
		change: Pick<StepChange, "type" | "intent" | "key">,
	): void | Promise<void>;
	/** Set when saved changes are handed to the reporter. */
	delivery: ChangeDelivery | null;
	limits: IntentLimits;
	session: SessionOptions;
	testInfo: TestInfo;
	request: APIRequestContext;
	testFile: string;
	titles: string[];
	testTitle: string;
	/** Step keys used in this attempt, to catch duplicates. */
	claimedKeys: Set<string>;
	/** Steps that have finished in this attempt, in run order. */
	finishedSteps: FinishedStep[];
	/** The replayed step in progress, which a test timeout can interrupt. */
	currentStep: RunningStep | null;
	/** This attempt's failure is already dealt with. */
	diagnosed: boolean;
	failureContext?: FailureContextProvider;
	localPath(key: string): string;
}

export interface FinishedStep {
	key: string;
	intent: string;
	code: string;
}

export function createTestScope(
	options: IntentOptions | undefined,
	testInfo: TestInfo,
	request: APIRequestContext,
	session: SessionOptions,
): TestScope {
	// `use` is partial in Playwright's types, so `intent` can be left out.
	if (!options?.store?.changes) {
		throw new IntentConfigError(
			"Set use.intent.store in playwright.config.ts, including changes: " +
				"store: fileStore({ changes: { local: allow(), ci: refuse() } })",
		);
	}
	if (options.agent && options.prompts) {
		throw new IntentConfigError(
			"use.intent.prompts only applies to the built-in agent, so it can't " +
				"be combined with use.intent.agent.",
		);
	}
	const root = configDirectory(testInfo.config);
	const changePolicy = resolveChangePolicy(options.store.changes);
	const titles = testInfo.titlePath.slice(1);
	const testTitle = titles.join(" > ");
	const intentRoot = path.join(root, INTENT_DIRECTORY);

	return {
		agent:
			changePolicy.name === "refuse"
				? null
				: (options.agent ??
					(options.model
						? createAiSdkAgent(options.model, options.prompts)
						: null)),
		store: options.store.open(intentRoot),
		checkChange: (change) => changePolicy.check({ ...change, test: testTitle }),
		delivery: deliveryOf(changePolicy),
		limits: { ...DEFAULT_LIMITS, ...options.limits },
		session,
		testInfo,
		request,
		testFile: path.relative(root, testInfo.file),
		titles,
		testTitle,
		claimedKeys: new Set(),
		finishedSteps: [],
		currentStep: null,
		diagnosed: false,
		failureContext: options.context,
		localPath: (key) => path.join(intentRoot, ...key.split("/")),
	};
}
