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

const NAMED_TEST_IMPORT =
	/\bimport\s+(?:[^{;\n]+,\s*)?\{[^};]*\btest\b[^};]*\}\s*from\s*['"]/;

function mayMatter(code: string): boolean {
	return (
		code.includes("@playwright/") ||
		code.includes(INTENT) ||
		code.includes(".extend") ||
		NAMED_TEST_IMPORT.test(code)
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

const TEST_METHODS = new Set([
	"describe",
	"extend",
	"beforeEach",
	"afterEach",
	"beforeAll",
	"afterAll",
	"use",
	"only",
	"skip",
	"fixme",
	"fail",
	"step",
	"info",
	"slow",
	"setTimeout",
]);

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

	const playwrightTestBindings = new Set<string>();
	const externalBindings = new Set<string>();

	for (const statement of ast.program.body as Node[]) {
		if (statement.type === "ImportDeclaration") {
			const source = statement.source.value;
			if (statement.importKind === "type") continue;
			const specifiers = statement.specifiers as Node[];
			const takesTest = specifiers.some(
				(specifier) =>
					specifier.type !== "ImportSpecifier" ||
					(specifier.importKind !== "type" &&
						exportedName(specifier.imported) === "test"),
			);

			if (source === PLAYWRIGHT || source === INTENT) {
				for (const specifier of specifiers) {
					if (specifier.importKind === "type") continue;
					if (
						specifier.type !== "ImportSpecifier" ||
						["test", "mergeTests"].includes(exportedName(specifier.imported))
					) {
						playwrightTestBindings.add(specifier.local.name);
					}
				}
			} else if (isPackage(source)) {
				for (const specifier of specifiers) {
					if (specifier.importKind !== "type") {
						externalBindings.add(specifier.local.name);
					}
				}
			} else {
				// Relative imports of `test` (or default) may be layered Playwright fixtures.
				for (const specifier of specifiers) {
					if (specifier.importKind === "type") continue;
					if (
						specifier.type === "ImportDefaultSpecifier" ||
						(specifier.type === "ImportSpecifier" &&
							exportedName(specifier.imported) === "test")
					) {
						playwrightTestBindings.add(specifier.local.name);
					}
				}
			}

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
				specifiers.some(
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

	// Collect CommonJS require bindings and chained Playwright fixture declarations.
	walk(ast.program, (node, parent) => {
		if (
			node.type === "CallExpression" &&
			node.callee.type === "Identifier" &&
			node.callee.name === "require" &&
			node.arguments[0]?.type === "StringLiteral" &&
			parent?.type === "VariableDeclarator"
		) {
			const source = node.arguments[0].value as string;
			if (source === PLAYWRIGHT || source === INTENT) {
				if (parent.id.type === "Identifier") {
					playwrightTestBindings.add(parent.id.name);
				} else if (parent.id.type === "ObjectPattern") {
					for (const property of parent.id.properties as Node[]) {
						const name = keyName(property);
						if (
							(name === "test" || name === "mergeTests") &&
							property.value?.type === "Identifier"
						) {
							playwrightTestBindings.add(property.value.name);
						}
					}
				}
			} else if (isPackage(source)) {
				walk(parent.id, (id) => {
					if (id.type === "Identifier") externalBindings.add(id.name);
				});
			} else if (parent.id.type === "ObjectPattern") {
				for (const property of parent.id.properties as Node[]) {
					if (
						keyName(property) === "test" &&
						property.value?.type === "Identifier"
					) {
						playwrightTestBindings.add(property.value.name);
					}
				}
			}
		} else if (
			parent?.type === "VariableDeclarator" &&
			parent.id.type === "Identifier" &&
			node.type === "CallExpression"
		) {
			const root = rootIdentifier(node.callee);
			if (root && playwrightTestBindings.has(root)) {
				playwrightTestBindings.add(parent.id.name);
			}
		}
	});

	walk(ast.program, (node, parent) => {
		if (isRequireOf(node, PLAYWRIGHT)) {
			const usage = requireUsage(ast.program, node, parent);
			if (usage === "module") {
				moveToIntent(node.arguments[0]);
			} else if (usage === "test") {
				moveToIntent(node.arguments[0]);
				edits.insert(end(node), ".test");
			}
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
			const root = rootIdentifier(node.callee.object);
			if (root && externalBindings.has(root)) return;
			const knownPlaywright = Boolean(root && playwrightTestBindings.has(root));
			for (const property of node.arguments[0].properties as Node[]) {
				const name = keyName(property);
				if (
					(name === "ai" || name === "intent") &&
					(knownPlaywright || isFixture(property))
				) {
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

function rootIdentifier(node: Node): string | undefined {
	let current = node;
	while (true) {
		if (current.type === "Identifier") return current.name;
		if (current.type === "MemberExpression") {
			current = current.object;
		} else if (current.type === "CallExpression") {
			current = current.callee;
		} else if (current.type === "ParenthesizedExpression") {
			current = current.expression;
		} else {
			return undefined;
		}
	}
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

/**
 * How a `require("@playwright/test")` call is used:
 * - `"module"`: switch to `require("playwright-intent")`
 * - `"test"`: switch to `require("playwright-intent").test` (Playwright's CJS
 *   export is callable directly, while playwright-intent's is a module object)
 * - `"none"`: doesn't use `test`, leave alone
 */
function requireUsage(
	program: Node,
	node: Node,
	parent: Node | undefined,
): "module" | "test" | "none" {
	if (parent?.type === "VariableDeclarator") {
		if (parent.id.type === "ObjectPattern") {
			return (parent.id.properties as Node[]).some(
				(property) => keyName(property) === "test",
			)
				? "module"
				: "none";
		}
		if (parent.id.type === "Identifier") {
			return identifierRequireUsage(program, parent.id.name);
		}
		return "module";
	}
	if (parent?.type === "MemberExpression") {
		return parent.property.type === "Identifier" &&
			parent.property.name === "test"
			? "module"
			: "none";
	}
	if (parent?.type === "CallExpression" && parent.callee === node) {
		return "test";
	}
	return "module";
}

function identifierRequireUsage(
	program: Node,
	name: string,
): "module" | "test" | "none" {
	let usesNamespaceTest = false;
	let usesAsTest = false;
	walk(program, (node, parent) => {
		if (node.type !== "Identifier" || node.name !== name) return;
		if (parent?.type === "MemberExpression" && parent.object === node) {
			if (parent.property.type === "Identifier") {
				if (parent.property.name === "test") usesNamespaceTest = true;
				else if (TEST_METHODS.has(parent.property.name)) usesAsTest = true;
			}
		} else if (parent?.type === "CallExpression" && parent.callee === node) {
			usesAsTest = true;
		}
	});
	if (usesNamespaceTest) return "module";
	if (usesAsTest) return "test";
	return "none";
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
