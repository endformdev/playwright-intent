import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
	end,
	keyName,
	lineOf,
	type Node,
	type Parse,
	SOURCE_FILE,
	start,
	TextEdits,
	walk,
	walkFiles,
} from "./source";

const PLAYWRIGHT = "@playwright/test";
const INTENT = "playwright-intent";

/** A file whose `test` will come from playwright-intent instead. */
export interface ImportRewrite {
	file: string;
	before: string;
	after: string;
}

/** A fixture that already uses a name playwright-intent adds. */
export interface FixtureConflict {
	file: string;
	line: number;
	name: string;
}

/** A package the suite takes `test` from, which builds on Playwright's. */
export interface TestPackage {
	name: string;
	/** The files that import `test` from it. */
	files: string[];
}

export interface TestImports {
	rewrites: ImportRewrite[];
	conflicts: FixtureConflict[];
	packages: TestPackage[];
	/** Files with component tests, which this doesn't set up. */
	componentTests: string[];
	/** Files that already take `test` from playwright-intent. */
	intentFiles: string[];
	/** Files that couldn't be parsed, so their imports weren't checked. */
	unreadable: string[];
}

/**
 * Finds every import of `test` from `@playwright/test` under `root`, and
 * what would get in the way of moving it to playwright-intent. Fixtures built
 * with `base.extend` keep working, because playwright-intent's `test` is an
 * extension of Playwright's own.
 */
export async function scanTestImports(
	root: string,
	parse: Parse,
	skip: string[] = [],
): Promise<TestImports> {
	const files = await sourceFiles(root, skip);
	const result: TestImports = {
		rewrites: [],
		conflicts: [],
		packages: [],
		componentTests: [],
		intentFiles: [],
		unreadable: [],
	};
	const packages = new Map<string, TestPackage | null>();

	for (const file of files) {
		const code = await fs.readFile(file, "utf8");
		if (!mayMatter(code)) continue;
		let scan: FileScan;
		try {
			scan = scanFile(code, file, parse);
		} catch {
			result.unreadable.push(file);
			continue;
		}
		if (scan.after !== code) {
			result.rewrites.push({ file, before: code, after: scan.after });
		}
		result.conflicts.push(...scan.conflicts);
		if (scan.componentTests) result.componentTests.push(file);
		if (scan.fromIntent) result.intentFiles.push(file);
		for (const source of scan.testSources) {
			const name = packageName(source);
			if (!packages.has(name)) {
				packages.set(name, await readTestPackage(name, file));
			}
			packages.get(name)?.files.push(file);
		}
	}

	result.packages = [...packages.values()].filter(
		(found): found is TestPackage => found !== null && found.files.length > 0,
	);
	return result;
}

/**
 * Without a parser, the files that look like they import `test` from
 * Playwright, for the user to change.
 */
export async function findPlaywrightImports(
	root: string,
	skip: string[] = [],
): Promise<string[]> {
	const found: string[] = [];
	for (const file of await sourceFiles(root, skip)) {
		const code = await fs.readFile(file, "utf8");
		if (PLAYWRIGHT_IMPORT.test(code)) found.push(file);
	}
	return found;
}

const PLAYWRIGHT_IMPORT = /\b(?:from|require\()\s*['"]@playwright\/test['"]/;

function sourceFiles(root: string, skip: string[]): Promise<string[]> {
	return walkFiles(
		root,
		(file) =>
			SOURCE_FILE.test(file) && !file.endsWith(".d.ts") && !skip.includes(file),
		// Another package's tests don't depend on playwright-intent.
		{ ownPackageOnly: true },
	);
}

function mayMatter(code: string): boolean {
	return (
		code.includes("@playwright/") ||
		code.includes(INTENT) ||
		code.includes(".extend") ||
		/\btest\b/.test(code)
	);
}

interface FileScan {
	after: string;
	conflicts: FixtureConflict[];
	componentTests: boolean;
	fromIntent: boolean;
	/** Other packages that `test` is imported from. */
	testSources: string[];
}

/** Throws when the file can't be parsed. */
export function scanFile(code: string, file: string, parse: Parse): FileScan {
	const ast = parse(code, file);
	const edits = new TextEdits(code);
	const scan: FileScan = {
		after: code,
		conflicts: [],
		componentTests: false,
		fromIntent: false,
		testSources: [],
	};
	const moveToIntent = (source: Node) => {
		edits.replace(start(source) + 1, end(source) - 1, INTENT);
	};

	for (const statement of ast.program.body as Node[]) {
		if (statement.type === "ImportDeclaration") {
			const source = statement.source.value;
			if (statement.importKind === "type") continue;
			const takesTest = (statement.specifiers as Node[]).some(
				(specifier) =>
					specifier.type !== "ImportSpecifier" ||
					(specifier.importKind !== "type" &&
						exportedName(specifier.imported) === "test"),
			);
			if (source.startsWith("@playwright/experimental-ct-")) {
				scan.componentTests = true;
			} else if (source === PLAYWRIGHT && takesTest) {
				moveToIntent(statement.source);
			} else if (source === INTENT && takesTest) {
				scan.fromIntent = true;
			} else if (
				takesTest &&
				isPackage(source) &&
				!source.startsWith("@playwright/") &&
				(statement.specifiers as Node[]).some(
					(specifier) =>
						specifier.type === "ImportSpecifier" &&
						exportedName(specifier.imported) === "test",
				)
			) {
				scan.testSources.push(source);
			}
		} else if (
			(statement.type === "ExportNamedDeclaration" ||
				statement.type === "ExportAllDeclaration") &&
			statement.source?.value === PLAYWRIGHT &&
			statement.exportKind !== "type"
		) {
			const reexportsTest =
				statement.type === "ExportAllDeclaration" ||
				(statement.specifiers as Node[]).some(
					(specifier) =>
						specifier.type === "ExportSpecifier" &&
						specifier.exportKind !== "type" &&
						["test", "default"].includes(exportedName(specifier.local)),
				);
			if (reexportsTest) moveToIntent(statement.source);
		}
	}

	walk(ast.program, (node, parent) => {
		if (isRequireOf(node, PLAYWRIGHT) && requiresTest(parent)) {
			moveToIntent(node.arguments[0]);
		}
		if (isRequireOf(node, INTENT) && requiresTest(parent)) {
			scan.fromIntent = true;
		}
		if (
			node.type === "CallExpression" &&
			node.callee.type === "MemberExpression" &&
			node.callee.property.type === "Identifier" &&
			node.callee.property.name === "extend" &&
			node.arguments[0]?.type === "ObjectExpression"
		) {
			for (const property of node.arguments[0].properties as Node[]) {
				const name = keyName(property);
				if ((name === "ai" || name === "intent") && isFixture(property)) {
					scan.conflicts.push({
						file,
						line: lineOf(code, start(property)),
						name,
					});
				}
			}
		}
	});

	scan.after = edits.toString();
	return scan;
}

function exportedName(node: Node): string {
	return node.type === "Identifier" ? node.name : node.value;
}

function isRequireOf(node: Node, module: string): boolean {
	return (
		node.type === "CallExpression" &&
		node.callee.type === "Identifier" &&
		node.callee.name === "require" &&
		node.arguments[0]?.type === "StringLiteral" &&
		node.arguments[0].value === module
	);
}

/** Whether a `require` result is used for `test`, not only for `expect`. */
function requiresTest(parent: Node | undefined): boolean {
	if (parent?.type === "VariableDeclarator") {
		if (parent.id.type !== "ObjectPattern") return true;
		return (parent.id.properties as Node[]).some(
			(property) => keyName(property) === "test",
		);
	}
	if (parent?.type === "MemberExpression") {
		return (
			parent.property.type === "Identifier" && parent.property.name === "test"
		);
	}
	return true;
}

/** `[fixture, options]` or a function that takes `use`, as fixtures do. */
function isFixture(property: Node): boolean {
	if (property.type === "ObjectMethod") return property.params.length >= 2;
	if (property.type !== "ObjectProperty") return false;
	const value = property.value;
	if (
		value.type === "ArrowFunctionExpression" ||
		value.type === "FunctionExpression"
	) {
		return value.params.length >= 2;
	}
	if (value.type === "ArrayExpression") {
		const options = value.elements[1];
		return (
			options?.type === "ObjectExpression" &&
			(options.properties as Node[]).some((option) =>
				["option", "auto", "scope", "timeout", "box", "title"].includes(
					keyName(option) ?? "",
				),
			)
		);
	}
	return false;
}

function isPackage(source: string): boolean {
	return (
		!source.startsWith(".") &&
		!source.startsWith("/") &&
		!source.startsWith("node:")
	);
}

function packageName(source: string): string {
	const parts = source.split("/");
	return source.startsWith("@")
		? parts.slice(0, 2).join("/")
		: (parts[0] ?? source);
}

/**
 * The package, when it can be found and builds on Playwright's `test`. Path
 * aliases and other test runners, like `vitest`, are left out.
 */
async function readTestPackage(
	name: string,
	from: string,
): Promise<TestPackage | null> {
	const manifest = await findManifest(name, from);
	if (!manifest) return null;
	const dependencies = {
		...manifest.dependencies,
		...manifest.devDependencies,
		...manifest.peerDependencies,
	};
	if (!(PLAYWRIGHT in dependencies) || INTENT in dependencies) return null;
	return { name, files: [] };
}

interface Manifest {
	name?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

async function findManifest(
	name: string,
	from: string,
): Promise<Manifest | null> {
	const require = createRequire(from);
	let entry: string;
	try {
		entry = require.resolve(`${name}/package.json`);
	} catch {
		try {
			entry = require.resolve(name);
		} catch {
			return null;
		}
	}
	let directory = path.dirname(entry);
	while (true) {
		const manifest = await fs
			.readFile(path.join(directory, "package.json"), "utf8")
			.then((text) => JSON.parse(text) as Manifest)
			.catch(() => null);
		if (manifest?.name === name) return manifest;
		const parent = path.dirname(directory);
		if (parent === directory) return null;
		directory = parent;
	}
}
