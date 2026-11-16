import * as vscode from "vscode";
import { findSteps, type StepFile } from "./find-steps";
import { findIntentCall } from "./intent-call";

const LANGUAGES = [
	"typescript",
	"typescriptreact",
	"javascript",
	"javascriptreact",
].map((language) => ({ language, scheme: "file" }));

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider(LANGUAGES, {
			provideDefinition(document, position) {
				// TypeScript already answers for `do`, and two answers open a peek.
				const found = intentAt(document, position);
				if (!found?.call.onIntent) return undefined;

				return found.steps.map((step) => ({
					originSelectionRange: found.range,
					targetUri: vscode.Uri.file(step.path),
					targetRange: new vscode.Range(step.codeLine, 0, step.codeLine, 0),
				}));
			},
		}),

		vscode.languages.registerHoverProvider(LANGUAGES, {
			provideHover(document, position) {
				const found = intentAt(document, position);
				if (!found) return undefined;
				return new vscode.Hover(describeSteps(found.steps), found.range);
			},
		}),
	);
}

function intentAt(document: vscode.TextDocument, position: vscode.Position) {
	const call = findIntentCall(
		document.fileName,
		document.getText(),
		document.offsetAt(position),
	);
	if (!call) return undefined;

	return {
		call,
		steps: findSteps(document.fileName, call),
		range: new vscode.Range(
			document.positionAt(call.start),
			document.positionAt(call.end),
		),
	};
}

function describeSteps(steps: StepFile[]): vscode.MarkdownString {
	const [step, ...others] = steps;
	const markdown = new vscode.MarkdownString();
	if (!step) {
		return markdown.appendMarkdown(
			"**Intent step:** none yet. The agent writes it on the next run.",
		);
	}

	const link = vscode.Uri.file(step.path).with({
		fragment: `L${step.codeLine + 1}`,
	});
	markdown
		.appendMarkdown(`**Intent step:** [${step.key}](${link})`)
		.appendCodeblock(step.code, "typescript");
	if (others.length > 0) {
		markdown.appendMarkdown(
			`${others.length} more steps have this intent. Go to Definition lists them all.`,
		);
	}
	return markdown;
}
