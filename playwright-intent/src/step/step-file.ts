export interface StepHeader {
	/** The exact intent. A mismatch means the intent changed: a cache miss. */
	intent: string;
	/** The exact test. A mismatch means two tests collided: a loud error. */
	test: string;
}

export interface StepSource extends StepHeader {
	/** The statements the agent produced. */
	code: string;
}

/** Line numbers in this file match what `renderStepFile` writes. */
const FIRST_CODE_LINE = 6;

const HEADER = /^\/\/ intent: (.+)\n\/\/ test: (.+)\n/;

/** Blank lines, comments, assertions, and locators kept for later. */
const READ_ONLY_LINE = /^($|\/\/|(await )?expect[.(]|const \w+ = page\.)/;

/** Line numbers in this file are what traces and error snippets show. */
export function renderStepFile({ intent, test, code }: StepSource): string {
	const body = code
		.trim()
		.split("\n")
		.map((line) => (line ? `\t${line}` : line))
		.join("\n");

	return `// intent: ${JSON.stringify(intent)}
// test: ${JSON.stringify(test)}
import type { StepContext } from "playwright-intent";

export default async function ({ page, context, request, expect, vars }: StepContext): Promise<void> {
${body}
}
`;
}

/** The statements in a step file, undoing what `renderStepFile` added. */
export function parseStepCode(source: string): string {
	const start = source.indexOf("Promise<void> {\n");
	if (start === -1) return "";
	return source
		.slice(start + "Promise<void> {\n".length, source.lastIndexOf("\n}"))
		.split("\n")
		.map((line) => line.replace(/^\t/, ""))
		.join("\n");
}

/**
 * Whether anything before a failure could have changed the page. It errs
 * towards yes, because a wrong yes only costs a retry.
 */
export function actedBeforeLine(code: string, fileLine: number): boolean {
	const lines = code.split("\n");
	const failing = fileLine - FIRST_CODE_LINE;
	const statements = (lines[failing] ?? "").split(";").filter((s) => s.trim());

	return (
		statements.length > 1 ||
		lines.slice(0, failing).some((line) => !READ_ONLY_LINE.test(line.trim()))
	);
}

export function parseStepHeader(source: string): StepHeader | null {
	const match = HEADER.exec(source);
	if (!match) return null;
	try {
		return {
			intent: JSON.parse(match[1]!) as string,
			test: JSON.parse(match[2]!) as string,
		};
	} catch {
		return null;
	}
}
