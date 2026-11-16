import ts from "typescript";

/** An `ai.do` call found in the source, with what its step key needs. */
export interface IntentCall {
	/** The intent template, with placeholders left in. */
	intent: string;
	/** Describe titles then the test title, or null when only a run knows them. */
	titles: string[] | null;
	/** Where the intent argument is, quotes included. */
	start: number;
	end: number;
	/** Whether the position is on the intent rather than on `do`. */
	onIntent: boolean;
}

const HOOKS = new Set(["beforeEach", "afterEach", "beforeAll", "afterAll"]);
const TEST_MODIFIERS = new Set(["only", "skip", "fixme", "fail"]);

/**
 * The `ai.do` call at `offset`, when it's on the `do` or on the intent. This
 * only reads syntax, so a `.do("...")` on anything else matches too. That's
 * harmless, because it only leads somewhere when a step has that intent.
 */
export function findIntentCall(
	fileName: string,
	source: string,
	offset: number,
): IntentCall | undefined {
	const sourceFile = ts.createSourceFile(
		fileName,
		source,
		ts.ScriptTarget.Latest,
		true,
	);

	const node = nodeAt(sourceFile, sourceFile, offset);
	const call = ts.isPropertyAccessExpression(node.parent)
		? node.parent.parent
		: node.parent;
	if (!call || !ts.isCallExpression(call)) return undefined;

	const callee = call.expression;
	const [intent] = call.arguments;
	if (
		!ts.isPropertyAccessExpression(callee) ||
		callee.name.text !== "do" ||
		!intent ||
		!ts.isStringLiteralLike(intent) ||
		(node !== intent && node !== callee.name)
	) {
		return undefined;
	}

	return {
		intent: intent.text,
		titles: titlesAround(call),
		start: intent.getStart(sourceFile),
		end: intent.getEnd(),
		onIntent: node === intent,
	};
}

function nodeAt(
	sourceFile: ts.SourceFile,
	node: ts.Node,
	offset: number,
): ts.Node {
	const child = ts.forEachChild(node, (child) =>
		child.getStart(sourceFile) <= offset && offset < child.getEnd()
			? child
			: undefined,
	);
	return child ? nodeAt(sourceFile, child, offset) : node;
}

/**
 * What `testInfo.titlePath.slice(1)` will be, read from the enclosing
 * `test(...)` and `test.describe(...)` calls. Null for titles that aren't
 * literals, and for calls outside a test or inside a hook.
 */
function titlesAround(call: ts.CallExpression): string[] | null {
	const titles: string[] = [];
	let inTest = false;

	for (let node: ts.Node = call; node.parent; node = node.parent) {
		const parent = node.parent;
		if (
			!ts.isCallExpression(parent) ||
			!ts.isFunctionLike(node) ||
			!parent.arguments.some((argument) => argument === node)
		) {
			continue;
		}

		const names = calleeNames(parent.expression);
		if (!names || names.includes("step")) continue;
		if (names.some((name) => HOOKS.has(name))) return null;

		const describe = names.includes("describe");
		if (!describe && !names.every((name) => TEST_MODIFIERS.has(name))) {
			continue;
		}

		const [title] = parent.arguments;
		if (describe && title === node) continue;
		if (!title || !ts.isStringLiteralLike(title)) return null;

		titles.unshift(title.text);
		inTest ||= !describe;
	}

	return inTest ? titles : null;
}

/** `test.describe.serial` → ["describe", "serial"]. */
function calleeNames(expression: ts.Expression): string[] | undefined {
	const names: string[] = [];
	while (ts.isPropertyAccessExpression(expression)) {
		names.unshift(expression.name.text);
		expression = expression.expression;
	}
	return ts.isIdentifier(expression) ? names : undefined;
}
