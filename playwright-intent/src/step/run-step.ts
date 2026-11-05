import { pathToFileURL } from "node:url";
import {
	type APIRequestContext,
	type BrowserContext,
	expect,
	type Page,
	test,
} from "@playwright/test";
import { createAgentSession } from "../agent/session";
import {
	IntentAgentFailedError,
	IntentDuplicateStepError,
	IntentNoAgentError,
	IntentRewindError,
	IntentStepConflictError,
	IntentStepMissingError,
} from "../errors";
import { readTestFile } from "../fixture/test-file";
import type { TestScope } from "../fixture/test-scope";
import { materializeStep } from "../store/file-store";
import { handleStepFailure } from "./handle-failure";
import {
	assertVariablesMatch,
	placeholderNames,
	type StepVariables,
} from "./intent-text";
import { parseStepHeader, renderStepFile } from "./step-file";
import { stepKey } from "./step-path";

/** What a step file receives. Steps can't import anything else at runtime. */
export interface StepContext {
	page: Page;
	context: BrowserContext;
	request: APIRequestContext;
	expect: typeof expect;
	vars: StepVariables;
}

type StepFunction = (context: StepContext) => Promise<void>;

export async function runStep(
	scope: TestScope,
	page: Page,
	intent: string,
	vars: StepVariables,
	line: number | undefined,
): Promise<void> {
	assertVariablesMatch(intent, vars);

	const key = stepKey({
		testFile: scope.testFile,
		titles: scope.titles,
		intent,
	});
	claimStep(scope, key, intent);

	const context: StepContext = {
		page,
		context: page.context(),
		request: scope.request,
		expect,
		vars,
	};

	const source = await readStep(scope, key, intent);
	if (source === null) {
		await generateStep(scope, context, key, intent, line);
	} else {
		await replayStep(scope, context, key, intent, source);
	}

	scope.previousSteps.push(intent);
}

function claimStep(scope: TestScope, key: string, intent: string): void {
	if (scope.claimedKeys.has(key)) {
		throw new IntentDuplicateStepError(
			`"${intent}" matches another step in this test, so both would use ` +
				`.intent/${key}. Reword one of them.`,
		);
	}
	scope.claimedKeys.add(key);
}

/** Returns the stored source, or null when the step needs generating. */
async function readStep(
	scope: TestScope,
	key: string,
	intent: string,
): Promise<string | null> {
	const source = await scope.store.get(key);
	if (source === null) return null;

	const header = parseStepHeader(source);
	if (header === null || header.test !== scope.testTitle) {
		throw new IntentStepConflictError(
			`.intent/${key} doesn't belong to "${scope.testTitle}". Two test ` +
				"titles may have sanitized to the same folder, or its header was edited.",
		);
	}
	return header.intent === intent ? source : null;
}

async function replayStep(
	scope: TestScope,
	context: StepContext,
	key: string,
	intent: string,
	source: string,
): Promise<void> {
	const file = scope.localPath(key);
	await materializeStep(file, source);

	const step = (await import(pathToFileURL(file).href)).default as StepFunction;

	const before =
		scope.mode === "changed"
			? await context.page.ariaSnapshot().catch(() => null)
			: null;

	try {
		await step(context);
	} catch (error) {
		if (scope.mode !== "changed") throw error;
		await handleStepFailure(scope, context, { key, intent, error, before });
	}
}

async function generateStep(
	scope: TestScope,
	context: StepContext,
	key: string,
	intent: string,
	line: number | undefined,
): Promise<void> {
	if (scope.mode === "none") {
		throw new IntentStepMissingError(
			`No step at .intent/${key}, and mode is "none". ` +
				"Run with PW_INTENT=missing to generate it.",
		);
	}
	if (!scope.agent) {
		throw new IntentNoAgentError(
			`Generating "${intent}" needs use.intent.model in playwright.config.ts.`,
		);
	}
	const agent = scope.agent;
	const testFile = await readTestFile(scope, line);

	scope.testInfo.setTimeout(scope.testInfo.timeout + scope.limits.timeoutMs);

	const outcome = await test.step(
		"agent: generate",
		() =>
			agent.generate(
				{
					intent,
					testTitle: scope.testTitle,
					testFile,
					variableNames: placeholderNames(intent),
					previousSteps: [...scope.previousSteps],
					limits: scope.limits,
				},
				createAgentSession(context, scope.session),
			),
		{ box: true },
	);

	if (outcome.transcript) {
		await scope.testInfo.attach(`agent: ${intent}`, {
			body: outcome.transcript,
			contentType: "text/plain",
		});
	}

	if (outcome.status === "failed") {
		throw new IntentAgentFailedError(
			`The agent couldn't complete "${intent}": ${outcome.message}`,
		);
	}

	const source = renderStepFile({
		intent,
		test: scope.testTitle,
		code: outcome.code,
	});
	await scope.store.put(key, source);
	await materializeStep(scope.localPath(key), source);

	if (outcome.page === "dirty") {
		throw new IntentRewindError(
			`Saved .intent/${key}, but the page can't continue from here. ` +
				"A retry, or the next run, will replay it from a clean page.",
		);
	}
}
