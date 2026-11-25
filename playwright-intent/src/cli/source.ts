import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * A node of Babel's syntax tree. The tree comes from Playwright's own copy of
 * Babel, so only the fields this reads are named.
 */
export interface Node {
	type: string;
	start?: number | null;
	end?: number | null;
	leadingComments?: { start?: number | null; end?: number | null }[] | null;
	// oxlint-disable-next-line no-explicit-any
	[field: string]: any;
}

/** Parses a file into a Babel `File` node. Throws on a syntax error. */
export type Parse = (code: string, file: string) => Node;

/**
 * Playwright parses tests and configs with a copy of Babel, which it exports
 * for its component testing packages. Using it adds no parser to this package.
 * It isn't documented, so anything unexpected gives null, and the caller
 * leaves the edits to the user.
 */
export function loadParser(directory: string): Parse | null {
	try {
		const fromProject = createRequire(path.join(directory, "noop.js"));
		const fromTest = createRequire(
			fromProject.resolve("@playwright/test/package.json"),
		);
		const { babelParse } = fromTest("playwright/lib/transform/babelBundle") as {
			babelParse?: unknown;
		};
		if (typeof babelParse !== "function") return null;
		const parse: Parse = (code, file) => babelParse(code, file, true) as Node;
		const probe = parse("export default defineConfig<T>({});", "probe.ts");
		return probe?.type === "File" ? parse : null;
	} catch {
		return null;
	}
}

/** Folders that never hold a suite's own source. */
const SKIPPED_FOLDERS = new Set([
	"node_modules",
	"test-results",
	"playwright-report",
	"blob-report",
	"dist",
	"build",
	"coverage",
]);

export const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

export interface WalkOptions {
	/** Leaves out folders with their own package.json, below the root. */
	ownPackageOnly?: boolean;
}

/** Every file under `root` that `include` accepts, skipping dot folders. */
export async function walkFiles(
	root: string,
	include: (file: string) => boolean,
	options: WalkOptions = {},
): Promise<string[]> {
	const found: string[] = [];
	const visit = async (directory: string): Promise<void> => {
		const entries = await fs
			.readdir(directory, { withFileTypes: true })
			.catch(() => []);
		if (
			options.ownPackageOnly &&
			directory !== root &&
			entries.some((entry) => entry.isFile() && entry.name === "package.json")
		) {
			return;
		}
		for (const entry of entries) {
			const full = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				if (entry.name.startsWith(".") || SKIPPED_FOLDERS.has(entry.name)) {
					continue;
				}
				await visit(full);
			} else if (entry.isFile() && include(full)) {
				found.push(full);
			}
		}
	};
	await visit(root);
	return found.sort();
}

const NOT_CHILDREN = new Set([
	"leadingComments",
	"trailingComments",
	"innerComments",
	"loc",
	"extra",
]);

/** Calls `visit` for every node below `node`, with its parent. */
export function walk(
	node: Node,
	visit: (node: Node, parent: Node | undefined) => void,
	parent?: Node,
): void {
	visit(node, parent);
	for (const [key, value] of Object.entries(node)) {
		if (NOT_CHILDREN.has(key)) continue;
		if (Array.isArray(value)) {
			for (const child of value) {
				if (isNode(child)) walk(child, visit, node);
			}
		} else if (isNode(value)) {
			walk(value, visit, node);
		}
	}
}

function isNode(value: unknown): value is Node {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { type?: unknown }).type === "string"
	);
}

export function start(node: Node): number {
	return node.start ?? 0;
}

export function end(node: Node): number {
	return node.end ?? 0;
}

/** The name of a non-computed property key, like `use` in `{ use: {} }`. */
export function keyName(property: Node): string | undefined {
	if (property.type !== "ObjectProperty" && property.type !== "ObjectMethod") {
		return undefined;
	}
	if (property.computed) return undefined;
	const { key } = property;
	if (key.type === "Identifier") return key.name;
	if (key.type === "StringLiteral") return key.value;
	return undefined;
}

export function findProperty(object: Node, name: string): Node | undefined {
	return (object.properties as Node[]).find(
		(property) => keyName(property) === name,
	);
}

export function lineOf(code: string, offset: number): number {
	return code.slice(0, offset).split("\n").length;
}

/** The whitespace at the start of the line that `offset` is on. */
export function indentAt(code: string, offset: number): string {
	const lineStart = code.lastIndexOf("\n", offset - 1) + 1;
	return /^[ \t]*/.exec(code.slice(lineStart))?.[0] ?? "";
}

/**
 * Text changes at positions in the original code, applied together. At the
 * same position, `insertBefore` goes ahead of everything, the latest first,
 * and `insert` goes after, in order.
 */
export class TextEdits {
	readonly #code: string;
	readonly #edits: {
		start: number;
		end: number;
		text: string;
		rank: number;
	}[] = [];
	#count = 0;

	constructor(code: string) {
		this.#code = code;
	}

	insert(position: number, text: string): void {
		this.#edits.push({
			start: position,
			end: position,
			text,
			rank: ++this.#count,
		});
	}

	insertBefore(position: number, text: string): void {
		this.#edits.push({
			start: position,
			end: position,
			text,
			rank: -1e9 - ++this.#count,
		});
	}

	replace(from: number, to: number, text: string): void {
		this.#edits.push({ start: from, end: to, text, rank: 1e9 + ++this.#count });
	}

	toString(): string {
		const edits = [...this.#edits].sort(
			(a, b) => a.start - b.start || a.rank - b.rank,
		);
		let result = "";
		let cursor = 0;
		for (const edit of edits) {
			if (edit.start < cursor) throw new Error("Overlapping edits.");
			result += this.#code.slice(cursor, edit.start) + edit.text;
			cursor = edit.end;
		}
		return result + this.#code.slice(cursor);
	}
}

export interface CodeStyle {
	quote: "'" | '"';
	semi: boolean;
	/** One level of indentation. */
	indent: string;
}

/** Reads quotes, semicolons and indentation, so added code fits in. */
export function detectStyle(code: string, ast: Node): CodeStyle {
	const quote = findFirstString(code, ast) ?? '"';
	const first = (ast.program.body as Node[]).find(
		(statement) =>
			statement.type === "ImportDeclaration" ||
			statement.type === "VariableDeclaration" ||
			statement.type === "ExpressionStatement" ||
			statement.type === "ExportDefaultDeclaration",
	);
	const semi = first
		? code.slice(start(first), end(first)).trimEnd().endsWith(";")
		: true;

	// Lines inside block comments start with " *", which isn't indentation.
	const indents = code
		.split("\n")
		.map((line) => /^[ \t]+(?=[^\s*])/.exec(line)?.[0])
		.filter((indent): indent is string => Boolean(indent));
	const indent = indents.some((value) => value.startsWith("\t"))
		? "\t"
		: indents.length > 0
			? " ".repeat(Math.min(...indents.map((value) => value.length)))
			: "\t";

	return { quote, semi, indent };
}

function findFirstString(code: string, ast: Node): CodeStyle["quote"] | null {
	let found: CodeStyle["quote"] | null = null;
	walk(ast.program, (node) => {
		if (found || node.type !== "StringLiteral") return;
		const raw = code[start(node)];
		if (raw === "'" || raw === '"') found = raw;
	});
	return found;
}

export function quoted(value: string, style: CodeStyle): string {
	return `${style.quote}${value}${style.quote}`;
}

/** Whether the file is loaded as ESM, which decides `import.meta.dirname`. */
export async function isEsm(file: string): Promise<boolean> {
	if (/\.m[jt]s$/.test(file)) return true;
	if (/\.c[jt]s$/.test(file)) return false;
	let directory = path.dirname(file);
	while (true) {
		const manifest = await fs
			.readFile(path.join(directory, "package.json"), "utf8")
			.catch(() => null);
		if (manifest !== null) {
			try {
				return (JSON.parse(manifest) as { type?: string }).type === "module";
			} catch {
				return false;
			}
		}
		const parent = path.dirname(directory);
		if (parent === directory) return false;
		directory = parent;
	}
}
