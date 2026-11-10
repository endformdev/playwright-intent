import path from "node:path";
import type { APIRequestContext, TestInfo } from "@playwright/test";
import type { FailureContextProvider, IntentAgent } from "../agent/agent";
import { createAiSdkAgent } from "../agent/ai-sdk-agent";
import type { SessionOptions } from "../agent/session";
import {
	assertIntentOptions,
	DEFAULT_LIMITS,
	type IntentLimits,
	type IntentOptions,
} from "../options";
import type { RunningStep } from "../step/handle-failure";
import { configDirectory, INTENT_DIRECTORY } from "../step/step-path";
import type { IntentStore, StepUpdates } from "../store/store";

/** Everything the steps of one test attempt share. */
export interface TestScope {
	/** Null without a model, and when the store refuses every change. */
	agent: IntentAgent | null;
	store: IntentStore;
	updates: StepUpdates;
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
	assertIntentOptions(options);
	const root = configDirectory(testInfo.config);
	const updates = options.store.updates(process.env);
	const titles = testInfo.titlePath.slice(1);
	const testTitle = titles.join(" > ");
	const intentRoot = path.join(root, INTENT_DIRECTORY);

	return {
		agent: updates.refused
			? null
			: (options.agent ??
				(options.model
					? createAiSdkAgent(options.model, options.prompts)
					: null)),
		store: options.store.open(intentRoot),
		updates,
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
