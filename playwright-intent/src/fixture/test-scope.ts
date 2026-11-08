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
import { INTENT_DIRECTORY } from "../step/step-path";
import { type NamedChangePolicy, resolveChangePolicy } from "../store/changes";
import type { IntentStore } from "../store/store";

/** Everything the steps of one test attempt share. */
export interface TestScope {
	agent: IntentAgent | null;
	store: IntentStore;
	changePolicy: NamedChangePolicy;
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
	const configFile = testInfo.config.configFile;
	const root = configFile ? path.dirname(configFile) : testInfo.config.rootDir;
	const intentRoot = path.join(root, INTENT_DIRECTORY);
	const titles = testInfo.titlePath.slice(1);

	return {
		agent:
			options.agent ??
			(options.model ? createAiSdkAgent(options.model, options.prompts) : null),
		store: options.store.open(intentRoot),
		changePolicy: resolveChangePolicy(options.store.changes),
		limits: { ...DEFAULT_LIMITS, ...options.limits },
		session,
		testInfo,
		request,
		testFile: path.relative(root, testInfo.file),
		titles,
		testTitle: titles.join(" > "),
		claimedKeys: new Set(),
		finishedSteps: [],
		currentStep: null,
		diagnosed: false,
		failureContext: options.context,
		localPath: (key) => path.join(intentRoot, ...key.split("/")),
	};
}
