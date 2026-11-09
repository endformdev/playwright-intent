import { stripVTControlCharacters } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import type { DiagnoseOutcome, FailureDecision } from "../agent/agent";
import { createAgentSession } from "../agent/session";
import { IntentRewindError } from "../errors";
import { lineInStack, readTestFile } from "../fixture/test-file";
import type { TestScope } from "../fixture/test-scope";
import { placeholderNames } from "./intent-text";
import { recordChange } from "./record-change";
import type { StepContext } from "./run-step";
import { saveStep } from "./save-step";
import { actedBeforeLine } from "./step-file";

/** A replayed step, kept on the scope until it finishes. */
export interface RunningStep {
	key: string;
	intent: string;
	code: string;
	line: number | undefined;
	/** Set once the step file has loaded and its code has started. */
	started: boolean;
	context: StepContext;
}

interface Failure {
	step: RunningStep | null;
	context: StepContext;
	error: string;
	/** Whether the step can't have changed the page before it failed. */
	pageUnchanged: boolean;
}

type Result =
	| { outcome: "continue"; code: string }
	| { outcome: "rewind"; message: string }
	| { outcome: "failed" };

/**
 * Runs on the live page when a replayed step throws.
 * Returns the code to record if the test can carry on from here.
 */
export async function handleStepFailure(
	scope: TestScope,
	step: RunningStep,
	error: unknown,
): Promise<string> {
	// The test may have timed out, leaving this to the fixture's teardown.
	if (scope.diagnosed) throw error;

	const result = await diagnoseFailure(scope, {
		step,
		context: step.context,
		error: errorMessage(error),
		pageUnchanged: leftPageUnchanged(scope, step, error),
	});

	if (result.outcome === "continue") return result.code;
	if (result.outcome === "rewind") throw new IntentRewindError(result.message);
	throw error;
}

/**
 * Runs in the fixture's teardown, for failures nothing else has diagnosed: a
 * hand-written line failed, or the test timed out inside a step. The test has
 * already failed by now, so the most this can do is prepare the next attempt.
 */
export async function handleTestFailure(
	scope: TestScope,
	page: Page,
): Promise<void> {
	const { status, error } = scope.testInfo;
	const step = scope.currentStep;
	const failed = status === "failed" || status === "timedOut";
	const hasSteps = scope.finishedSteps.length > 0 || step !== null;

	if (!scope.agent || !failed || !hasSteps || scope.diagnosed) return;

	const result = await diagnoseFailure(scope, {
		step,
		context: step?.context ?? {
			page,
			context: page.context(),
			request: scope.request,
			expect,
			vars: {},
		},
		error: stripVTControlCharacters(error?.message ?? `The test ${status}.`),
		pageUnchanged: false,
	});

	if (result.outcome === "rewind") report(scope, result.message);
}

async function diagnoseFailure(
	scope: TestScope,
	failure: Failure,
): Promise<Result> {
	scope.diagnosed = true;
	const agent = scope.agent;
	if (!agent) return { outcome: "failed" };

	const { step, context, error, pageUnchanged } = failure;
	const canContinue = scope.testInfo.status === "passed";
	const intent = step?.intent ?? "";

	try {
		await scope.checkChange({
			type: "diagnose",
			...(step && { intent, key: step.key }),
		});
	} catch (cause) {
		report(scope, `Skipped the diagnosis: ${errorMessage(cause)}`);
		return { outcome: "failed" };
	}

	scope.testInfo.setTimeout(scope.testInfo.timeout + scope.limits.timeoutMs);

	let decision: DiagnoseOutcome;
	try {
		decision = await test.step(
			"agent: diagnose",
			async () =>
				agent.diagnose(
					{
						intent,
						testTitle: scope.testTitle,
						testFile: await readTestFile(scope, step?.line),
						variableNames: placeholderNames(intent),
						previousSteps: scope.finishedSteps.map((done) => done.intent),
						limits: scope.limits,
						location: step ? "step" : "outside",
						error,
						code: step?.code,
						pageUnchanged,
						steps: scope.finishedSteps.map(({ intent, code }) => ({
							intent,
							code,
						})),
						extraContext: await scope.failureContext?.({
							testTitle: scope.testTitle,
							intent: step?.intent,
							error,
						}),
					},
					createAgentSession(context, scope.session),
				),
			{ box: true },
		);
	} catch (cause) {
		// A broken diagnosis must never hide the test's own failure.
		report(scope, `The diagnosis failed: ${errorMessage(cause)}`);
		return { outcome: "failed" };
	}

	if (decision.transcript) {
		await scope.testInfo.attach("agent: diagnose", {
			body: decision.transcript,
			contentType: "text/plain",
		});
	}

	return applyDecision(scope, failure, decision, pageUnchanged && canContinue);
}

async function applyDecision(
	scope: TestScope,
	{ step }: Failure,
	decision: FailureDecision,
	canContinue: boolean,
): Promise<Result> {
	const label = step ? `"${step.intent}"` : "the test";
	const because = decision.reason ? `: ${decision.reason}` : "";

	switch (decision.action) {
		case "repair": {
			if (!step) {
				report(scope, `The agent can't repair code outside a step${because}`);
				return { outcome: "failed" };
			}
			const source = await saveStep(
				scope,
				step.key,
				step.intent,
				decision.code,
			);
			await recordChange(scope, {
				kind: "write",
				key: step.key,
				cause: "repair",
				reason: decision.reason,
				source,
			});
			report(scope, `Repaired ${label}${because}`);
			reportChangedAssertions(scope, step.code, decision.code);

			if (decision.page === "ready" && canContinue) {
				return { outcome: "continue", code: decision.code };
			}
			return {
				outcome: "rewind",
				message: `Saved a repair for ${label}, but this attempt can't continue from here. A retry, or the next run, will replay it from a clean page.`,
			};
		}

		case "regenerate": {
			const known = step ? [...scope.finishedSteps, step] : scope.finishedSteps;
			const named = known.filter(({ intent }) =>
				decision.steps.includes(intent),
			);
			if (named.length === 0) {
				report(
					scope,
					`The agent asked to regenerate steps that aren't in this test: ${decision.steps.join(", ")}`,
				);
				return { outcome: "failed" };
			}
			for (const { key } of named) {
				await scope.store.delete(key);
				await recordChange(scope, {
					kind: "delete",
					key,
					cause: "regenerate",
					reason: decision.reason,
				});
			}
			const names = named.map(({ intent }) => `"${intent}"`).join(", ");
			report(scope, `Regenerating ${names}${because}`);
			return {
				outcome: "rewind",
				message: `Deleted ${names}. A retry, or the next run, will generate them again.`,
			};
		}

		case "fail":
			await recordChange(scope, {
				kind: "diagnosis",
				key: step?.key,
				reason: decision.reason,
			});
			report(scope, `Left the steps alone after ${label} failed${because}`);
			return { outcome: "failed" };
	}
}

/** Annotations reach reports, and `console.log` reaches the terminal. */
function report(scope: TestScope, message: string): void {
	scope.testInfo.annotations.push({ type: "intent", description: message });
	console.log(`[intent] ${message}`);
}

function reportChangedAssertions(
	scope: TestScope,
	before: string,
	after: string,
): void {
	const assertions = (code: string) =>
		code
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.includes("expect("));
	/** Compares without whitespace, so reformatting isn't reported. */
	const withoutLines = (lines: string[], others: string[]) => {
		const compact = (line: string) => line.replace(/\s/g, "");
		const known = new Set(others.map(compact));
		return lines.filter((line) => !known.has(compact(line)));
	};
	const oldLines = assertions(before);
	const newLines = assertions(after);
	const changes = [
		...withoutLines(oldLines, newLines).map((line) => `- ${line}`),
		...withoutLines(newLines, oldLines).map((line) => `+ ${line}`),
	];
	if (changes.length > 0) {
		report(scope, `Check these assertion changes:\n${changes.join("\n")}`);
	}
}

function leftPageUnchanged(
	scope: TestScope,
	step: RunningStep,
	error: unknown,
): boolean {
	if (!step.started) return true;
	const stack = error instanceof Error ? error.stack : undefined;
	const line = lineInStack(stack, scope.localPath(step.key));
	return line !== undefined && !actedBeforeLine(step.code, line);
}

function errorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return stripVTControlCharacters(message);
}
