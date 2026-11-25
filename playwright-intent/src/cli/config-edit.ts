import {
	type CodeStyle,
	detectStyle,
	end,
	findProperty,
	indentAt,
	lineOf,
	type Node,
	type Parse,
	quoted,
	start,
	TextEdits,
	walk,
} from "./source";

export const DEFAULT_MODEL = "openai/gpt-6-luna";

export interface ConfigEditInput {
	code: string;
	file: string;
	parse: Parse;
	/** Whether Playwright loads the config as ESM, which decides its dirname. */
	esm: boolean;
	/** The AI Gateway model to write, when the config has no intent options. */
	model: string;
}

export interface ConfigEdit {
	code: string;
	/** What was added, like "intent options". */
	added: string[];
	/** Steps that couldn't be made safely, each with what to write. */
	manual: string[];
	/** The AI Gateway model the config ends up with, when it's a string. */
	gatewayModel?: string;
}

interface ConfigTarget {
	object: Node;
	/** The top-level statement the object is in, where `intent` must be ready. */
	statement: Node;
	/** Where the config's type takes `IntentUseOptions`. */
	typeSlots: Node[];
}

/** The `.env` lines that `npm init playwright` leaves commented out. */
const DOTENV_TEMPLATE =
	/^(?:\/\*\*\r?\n \* Read environment variables from file\.\r?\n \* https:\/\/github\.com\/motdotla\/dotenv\r?\n \*\/\r?\n)?\/\/ ?import dotenv from ['"]dotenv['"];?\r?\n(?:\/\/ ?import path from ['"](?:node:)?path['"];?\r?\n)?\/\/ ?dotenv\.config\(.*\);?$/m;

/**
 * Adds intent options, the reporter and `.env` loading to a Playwright
 * config, changing nothing else. Each part that's already there is left
 * alone, and each part that can't be added safely comes back in `manual`.
 */
export function editConfig(input: ConfigEditInput): ConfigEdit {
	const { code, file } = input;
	let ast: Node;
	try {
		ast = input.parse(code, file);
	} catch {
		return {
			code,
			added: [],
			manual: [handEditMessage(file, input.model, "can't be parsed")],
			gatewayModel: input.model,
		};
	}
	const style = detectStyle(code, ast);
	const typed = /\.[cm]?tsx?$/.test(file);
	const body = ast.program.body as Node[];
	const requireSyntax = usesRequireSyntax(body);
	const edits = new TextEdits(code);
	const added: string[] = [];
	const manual: string[] = [];
	const q = (value: string) => quoted(value, style);
	const semi = style.semi ? ";" : "";

	const target = findConfigTarget(body);
	if (!target) {
		return {
			code,
			added,
			manual: [
				handEditMessage(
					file,
					input.model,
					"doesn't export an object it can find",
				),
			],
			gatewayModel: input.model,
		};
	}

	const bound = topLevelNames(body);
	const existingOptions = findIntentOption(target.object);
	const newName = freshName("intent", "intentOptions", bound);
	const optionsName = existingOptions
		? optionsReference(existingOptions)
		: newName;

	const importLines: string[] = [];
	const typeNames: string[] = [];
	const configAdditions: string[] = [];
	let useAddition: string | undefined;

	if (!existingOptions) {
		if (typed) typeNames.push("IntentOptions");
		importLines.push(
			requireSyntax
				? `const { allow, fileStore, refuse } = require(${q("playwright-intent/file-store")})${semi}`
				: `import { allow, fileStore, refuse } from ${q("playwright-intent/file-store")}${semi}`,
		);
		edits.insertBefore(
			statementStart(code, target.statement),
			`${declaration(newName, input.model, typed, style)}\n\n`,
		);

		const useEntry = newName === "intent" ? "intent" : `intent: ${newName}`;
		const use = findProperty(target.object, "use");
		if (!use) {
			useAddition = `use: { ${useEntry} }`;
		} else if (
			use.type === "ObjectProperty" &&
			use.value.type === "ObjectExpression"
		) {
			prependItem(edits, code, style, use.value, useEntry);
		} else {
			manual.push(
				`Add ${useEntry} to use in ${fileName(file)}, like use: { ...yourUse, ${useEntry} }.`,
			);
		}
		added.push("intent options");
	}

	if (!hasReporter(ast)) {
		if (!optionsName) {
			manual.push(
				`Pass the same options as use.intent to the reporter in ${fileName(file)}:\n\n  reporter: [["list"], ["playwright-intent/reporter", intent]],`,
			);
		} else {
			const entry = `[${q("playwright-intent/reporter")}, ${optionsName}]`;
			const reporter = findProperty(target.object, "reporter");
			const value =
				reporter?.type === "ObjectProperty" ? reporter.value : undefined;
			if (!reporter) {
				configAdditions.push(`reporter: [[${q("list")}], ${entry}]`);
				added.push("reporter");
			} else if (value?.type === "StringLiteral") {
				edits.replace(
					start(value),
					end(value),
					`[[${code.slice(start(value), end(value))}], ${entry}]`,
				);
				added.push("reporter");
			} else if (value?.type === "ArrayExpression") {
				appendItems(edits, code, style, value, value.elements, [entry]);
				added.push("reporter");
			} else {
				manual.push(
					`Add the intent reporter to reporter in ${fileName(file)}, next to your own:\n\n  ${entry},`,
				);
			}
		}
	}

	if (useAddition) configAdditions.push(useAddition);
	if (configAdditions.length > 0) {
		appendItems(
			edits,
			code,
			style,
			target.object,
			target.object.properties,
			configAdditions,
		);
	}

	if (typed) {
		let addedUseType = false;
		for (const slot of target.typeSlots) {
			const first = slot.typeParameters?.params?.[0] as Node | undefined;
			if (first && hasTypeReference(first, "IntentUseOptions")) continue;
			if (first) {
				if (first.type === "TSUnionType") {
					edits.insert(start(first), "(");
					edits.insert(end(first), ") & IntentUseOptions");
				} else {
					edits.insert(end(first), " & IntentUseOptions");
				}
			} else {
				const after =
					slot.type === "CallExpression" ? slot.callee : slot.typeName;
				edits.insert(end(after), "<IntentUseOptions>");
			}
			addedUseType = true;
		}
		if (addedUseType) typeNames.push("IntentUseOptions");
	}

	const neededTypes = typeNames.filter((name) => !bound.has(name));
	if (neededTypes.length > 0) {
		importLines.unshift(
			`import type { ${neededTypes.join(", ")} } from ${q("playwright-intent")}${semi}`,
		);
	}

	let envLines: string[] | undefined;
	if (!loadsEnvFile(ast)) {
		const moduleImport = (name: string, module: string) =>
			requireSyntax
				? `const ${name} = require(${q(module)})${semi}`
				: `import ${name} from ${q(module)}${semi}`;
		const fsName = moduleBinding(body, ["fs", "node:fs"]);
		const pathName = moduleBinding(body, ["path", "node:path"]);
		const fsRef = fsName ?? freshName("fs", "intentFs", bound);
		const pathRef = pathName ?? freshName("path", "intentPath", bound);
		if (!fsName) importLines.push(moduleImport(fsRef, "node:fs"));
		if (!pathName) importLines.push(moduleImport(pathRef, "node:path"));
		const dirname = input.esm ? "import.meta.dirname" : "__dirname";
		const variable = freshName("envFile", "intentEnvFile", bound);
		envLines = [
			`const ${variable} = ${pathRef}.join(${dirname}, ${q(".env")})${semi}`,
			`if (${fsRef}.existsSync(${variable})) process.loadEnvFile(${variable})${semi}`,
		];
		const template = DOTENV_TEMPLATE.exec(code);
		if (template) {
			const eol = code.includes("\r\n") ? "\r\n" : "\n";
			edits.replace(
				template.index,
				template.index + template[0].length,
				[
					"/**",
					" * Read environment variables from file.",
					" */",
					...envLines,
				].join(eol),
			);
			envLines = undefined;
		}
		added.push(".env loading");
	}

	if (importLines.length > 0 || envLines) {
		const text = [
			...importLines.map((line) => `\n${line}`),
			...(envLines ? [`\n\n${envLines.join("\n")}`] : []),
		].join("");
		const lastImport = lastImportStatement(
			body,
			requireSyntax,
			target.statement,
		);
		if (lastImport) {
			edits.insert(end(lastImport), text);
		} else {
			edits.insertBefore(0, `${text.trimStart()}\n\n`);
		}
	}

	return {
		code: edits.toString(),
		added,
		manual,
		gatewayModel: existingOptions
			? findGatewayModel(body, existingOptions)
			: input.model,
	};
}

/** The README's config, for configs that can't be edited. */
export function configSnippet(model: string): string {
	return `import fs from "node:fs";
import path from "node:path";
import type { IntentOptions, IntentUseOptions } from "playwright-intent";
import { allow, fileStore, refuse } from "playwright-intent/file-store";

const envFile = path.join(import.meta.dirname, ".env"); // __dirname in CommonJS
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const intent = {
	model: "${model}",
	store: fileStore({ updates: { local: allow(), ci: refuse() } }),
} satisfies IntentOptions;

export default defineConfig<IntentUseOptions>({
	reporter: [["list"], ["playwright-intent/reporter", intent]],
	use: { intent },
});`;
}

function handEditMessage(file: string, model: string, problem: string) {
	return `${fileName(file)} ${problem}, so add the intent options by hand:\n\n${configSnippet(model)}`;
}

function declaration(
	name: string,
	model: string,
	typed: boolean,
	style: CodeStyle,
): string {
	const i = style.indent;
	const semi = style.semi ? ";" : "";
	const lines = [
		`const ${name} = {`,
		`${i}model: ${quoted(model, style)},`,
		`${i}store: fileStore({ updates: { local: allow(), ci: refuse() } }),`,
		`}${typed ? " satisfies IntentOptions" : ""}${semi}`,
	];
	if (!typed) {
		lines.unshift(
			`/** @type {import(${quoted("playwright-intent", style)}).IntentOptions} */`,
		);
	}
	return lines.join("\n");
}

function fileName(file: string): string {
	return file.split(/[\\/]/).at(-1) ?? file;
}

function usesRequireSyntax(body: Node[]): boolean {
	const esm = body.some(
		(statement) =>
			statement.type === "ImportDeclaration" ||
			statement.type === "ExportDefaultDeclaration" ||
			statement.type === "ExportNamedDeclaration",
	);
	return !esm && body.some((statement) => moduleExportsValue(statement));
}

function moduleExportsValue(statement: Node): Node | undefined {
	if (statement.type !== "ExpressionStatement") return undefined;
	const expression = statement.expression;
	if (
		expression.type === "AssignmentExpression" &&
		expression.left.type === "MemberExpression" &&
		expression.left.object.type === "Identifier" &&
		expression.left.object.name === "module" &&
		expression.left.property.type === "Identifier" &&
		expression.left.property.name === "exports"
	) {
		return expression.right;
	}
	return undefined;
}

function findConfigTarget(body: Node[]): ConfigTarget | undefined {
	for (const statement of body) {
		if (statement.type === "ExportDefaultDeclaration") {
			return resolveConfig(body, statement.declaration, statement, []);
		}
		const exported = moduleExportsValue(statement);
		if (exported) return resolveConfig(body, exported, statement, []);
	}
	return undefined;
}

function resolveConfig(
	body: Node[],
	expression: Node,
	statement: Node,
	typeSlots: Node[],
	depth = 0,
): ConfigTarget | undefined {
	if (depth > 5) return undefined;
	switch (expression.type) {
		case "ObjectExpression":
			return { object: expression, statement, typeSlots };
		case "TSSatisfiesExpression":
		case "TSAsExpression": {
			if (isConfigType(expression.typeAnnotation)) {
				typeSlots.push(expression.typeAnnotation);
			}
			return resolveConfig(
				body,
				expression.expression,
				statement,
				typeSlots,
				depth + 1,
			);
		}
		case "ParenthesizedExpression":
			return resolveConfig(
				body,
				expression.expression,
				statement,
				typeSlots,
				depth + 1,
			);
		case "CallExpression": {
			if (!isDefineConfig(expression.callee)) return undefined;
			typeSlots.push(expression);
			const args = expression.arguments as Node[];
			const last = args
				.map((arg) => {
					const argSlots: Node[] = [];
					const unwrapped = unwrapExpression(arg, argSlots);
					return unwrapped.type === "ObjectExpression"
						? { object: unwrapped, argSlots }
						: undefined;
				})
				.filter(
					(entry): entry is { object: Node; argSlots: Node[] } =>
						entry !== undefined,
				)
				.at(-1);
			if (last) {
				typeSlots.push(...last.argSlots);
				return { object: last.object, statement, typeSlots };
			}
			const only = args[0];
			if (args.length === 1 && only) {
				const unwrapped = unwrapExpression(only, typeSlots);
				if (unwrapped.type === "Identifier") {
					return resolveConfig(
						body,
						unwrapped,
						statement,
						typeSlots,
						depth + 1,
					);
				}
			}
			return undefined;
		}
		case "Identifier": {
			const binding = findVariable(body, expression.name);
			if (!binding) return undefined;
			const annotation = binding.declarator.id.typeAnnotation;
			if (
				annotation?.type === "TSTypeAnnotation" &&
				isConfigType(annotation.typeAnnotation)
			) {
				typeSlots.push(annotation.typeAnnotation);
			}
			return resolveConfig(
				body,
				binding.init,
				binding.statement,
				typeSlots,
				depth + 1,
			);
		}
		default:
			return undefined;
	}
}

function unwrapExpression(node: Node, typeSlots?: Node[]): Node {
	let current = node;
	while (true) {
		if (current.type === "ParenthesizedExpression") {
			current = current.expression;
		} else if (
			current.type === "TSSatisfiesExpression" ||
			current.type === "TSAsExpression"
		) {
			if (typeSlots && isConfigType(current.typeAnnotation)) {
				typeSlots.push(current.typeAnnotation);
			}
			current = current.expression;
		} else {
			return current;
		}
	}
}

function findVariable(
	body: Node[],
	name: string,
): { statement: Node; declarator: Node; init: Node } | undefined {
	for (const candidate of body) {
		const declaration =
			candidate.type === "ExportNamedDeclaration"
				? candidate.declaration
				: candidate;
		if (declaration?.type !== "VariableDeclaration") continue;
		for (const declarator of declaration.declarations as Node[]) {
			if (
				declarator.id.type === "Identifier" &&
				declarator.id.name === name &&
				declarator.init
			) {
				return { statement: candidate, declarator, init: declarator.init };
			}
		}
	}
	return undefined;
}

function isDefineConfig(callee: Node): boolean {
	if (callee.type === "Identifier") return callee.name === "defineConfig";
	return (
		callee.type === "MemberExpression" &&
		callee.property.type === "Identifier" &&
		callee.property.name === "defineConfig"
	);
}

function isConfigType(type: Node): boolean {
	if (type.type !== "TSTypeReference") return false;
	const name =
		type.typeName.type === "Identifier"
			? type.typeName.name
			: type.typeName.type === "TSQualifiedName"
				? type.typeName.right.name
				: "";
	return name === "PlaywrightTestConfig";
}

function hasTypeReference(type: Node, name: string): boolean {
	let found = false;
	walk(type, (node) => {
		if (found || node.type !== "TSTypeReference") return;
		const refName =
			node.typeName.type === "Identifier"
				? node.typeName.name
				: node.typeName.type === "TSQualifiedName"
					? node.typeName.right.name
					: "";
		if (refName === name) found = true;
	});
	return found;
}

function hasReporter(ast: Node): boolean {
	let found = false;
	walk(ast.program, (node) => {
		if (found) return;
		if (
			node.type === "StringLiteral" &&
			node.value === "playwright-intent/reporter"
		) {
			found = true;
		} else if (
			node.type === "TemplateLiteral" &&
			node.expressions.length === 0 &&
			node.quasis[0]?.value?.cooked === "playwright-intent/reporter"
		) {
			found = true;
		}
	});
	return found;
}

/** The `intent` property in top-level `use` or a project's `use`. */
function findIntentOption(object: Node): Node | undefined {
	const use = findProperty(object, "use");
	if (use?.type === "ObjectProperty" && use.value.type === "ObjectExpression") {
		const found = findProperty(use.value, "intent");
		if (found) return found;
	}
	const projects = findProperty(object, "projects");
	if (
		projects?.type === "ObjectProperty" &&
		projects.value.type === "ArrayExpression"
	) {
		for (const project of projects.value.elements as (Node | null)[]) {
			if (project?.type !== "ObjectExpression") continue;
			const projectUse = findProperty(project, "use");
			if (
				projectUse?.type === "ObjectProperty" &&
				projectUse.value.type === "ObjectExpression"
			) {
				const found = findProperty(projectUse.value, "intent");
				if (found) return found;
			}
		}
	}
	return undefined;
}

/** The name the existing options go by, when the reporter can reuse it. */
function optionsReference(property: Node): string | undefined {
	if (property.type !== "ObjectProperty") return undefined;
	return property.value.type === "Identifier" ? property.value.name : undefined;
}

/**
 * Where a statement starts, including the comments right above it. Comments
 * further up, after a blank line, belong to something else.
 */
function statementStart(code: string, statement: Node): number {
	let position = start(statement);
	for (const comment of [...(statement.leadingComments ?? [])].reverse()) {
		const gap = code.slice(comment.end ?? 0, position);
		if (/\r?\n[ \t]*\r?\n/.test(gap)) break;
		position = comment.start ?? position;
	}
	return position;
}

function freshName(
	preferred: string,
	fallback: string,
	bound: Set<string>,
): string {
	if (!bound.has(preferred)) return preferred;
	if (!bound.has(fallback)) return fallback;
	let suffix = 2;
	while (bound.has(`${fallback}${suffix}`)) suffix++;
	return `${fallback}${suffix}`;
}

function topLevelNames(body: Node[]): Set<string> {
	const names = new Set<string>();
	for (const statement of body) {
		const declaration =
			statement.type === "ExportNamedDeclaration"
				? statement.declaration
				: statement;
		if (!declaration) continue;
		if (declaration.type === "ImportDeclaration") {
			for (const specifier of declaration.specifiers as Node[]) {
				names.add(specifier.local.name);
			}
		} else if (declaration.type === "VariableDeclaration") {
			for (const declarator of declaration.declarations as Node[]) {
				walk(declarator.id, (node) => {
					if (node.type === "Identifier") names.add(node.name);
				});
			}
		} else if (
			(declaration.type === "FunctionDeclaration" ||
				declaration.type === "ClassDeclaration") &&
			declaration.id
		) {
			names.add(declaration.id.name);
		}
	}
	return names;
}

function isRequireOf(node: Node | null | undefined, modules: string[]) {
	return (
		node?.type === "CallExpression" &&
		node.callee.type === "Identifier" &&
		node.callee.name === "require" &&
		node.arguments[0]?.type === "StringLiteral" &&
		modules.includes(node.arguments[0].value)
	);
}

function loadsEnvFile(ast: Node): boolean {
	let loads = false;
	walk(ast.program, (node) => {
		if (loads) return;
		if (
			node.type === "ImportDeclaration" &&
			["dotenv", "dotenv/config"].includes(node.source.value)
		) {
			loads = true;
		} else if (isRequireOf(node, ["dotenv", "dotenv/config"])) {
			loads = true;
		} else if (
			node.type === "MemberExpression" &&
			node.object.type === "Identifier" &&
			node.object.name === "process" &&
			node.property.type === "Identifier" &&
			node.property.name === "loadEnvFile"
		) {
			loads = true;
		}
	});
	return loads;
}

/** The local name of a whole-module import, like `path` from `node:path`. */
function moduleBinding(body: Node[], modules: string[]): string | undefined {
	for (const statement of body) {
		if (
			statement.type === "ImportDeclaration" &&
			statement.importKind !== "type" &&
			modules.includes(statement.source.value)
		) {
			const whole = (statement.specifiers as Node[]).find(
				(specifier) => specifier.type !== "ImportSpecifier",
			);
			if (whole) return whole.local.name;
		}
		if (statement.type === "VariableDeclaration") {
			for (const declarator of statement.declarations as Node[]) {
				if (
					declarator.id.type === "Identifier" &&
					isRequireOf(declarator.init, modules)
				) {
					return declarator.id.name;
				}
			}
		}
	}
	return undefined;
}

function lastImportStatement(
	body: Node[],
	requireSyntax: boolean,
	before: Node,
): Node | undefined {
	const limit = body.indexOf(before);
	const prefix = limit === -1 ? body : body.slice(0, limit);
	return prefix.findLast((statement) =>
		requireSyntax
			? statement.type === "VariableDeclaration" &&
				(statement.declarations as Node[]).some((declarator) =>
					containsRequire(declarator.init),
				)
			: statement.type === "ImportDeclaration",
	);
}

function containsRequire(node: Node | null | undefined): boolean {
	if (!node) return false;
	let found = false;
	walk(node, (child) => {
		if (
			child.type === "CallExpression" &&
			child.callee.type === "Identifier" &&
			child.callee.name === "require"
		) {
			found = true;
		}
	});
	return found;
}

function findGatewayModel(
	body: Node[],
	existingOptions: Node,
): string | undefined {
	if (existingOptions.type !== "ObjectProperty") return undefined;
	const value = unwrapExpression(existingOptions.value);
	const optionsObject =
		value.type === "ObjectExpression"
			? value
			: value.type === "Identifier"
				? (() => {
						const binding = findVariable(body, value.name);
						if (!binding) return undefined;
						const init = unwrapExpression(binding.init);
						return init.type === "ObjectExpression" ? init : undefined;
					})()
				: undefined;
	if (!optionsObject) return undefined;
	const modelProperty = findProperty(optionsObject, "model");
	if (modelProperty?.type !== "ObjectProperty") return undefined;
	const modelValue = unwrapExpression(modelProperty.value);
	if (modelValue.type === "StringLiteral") return modelValue.value;
	if (modelValue.type === "Identifier") {
		const binding = findVariable(body, modelValue.name);
		const init = binding ? unwrapExpression(binding.init) : undefined;
		if (init?.type === "StringLiteral") return init.value;
	}
	return undefined;
}

/** Adds items after the last child of an object or array literal. */
function appendItems(
	edits: TextEdits,
	code: string,
	style: CodeStyle,
	container: Node,
	children: (Node | null)[],
	items: string[],
): void {
	const present = children.filter((child): child is Node => child !== null);
	const last = present.at(-1);

	if (!last) {
		const inside = code.slice(start(container) + 1, end(container) - 1);
		if (container.type === "ArrayExpression") {
			if (inside.trim().length === 0) {
				edits.replace(
					start(container),
					end(container),
					`[${items.join(", ")}]`,
				);
			} else {
				const inner = `${indentAt(code, start(container))}${style.indent}`;
				edits.insert(
					start(container) + 1,
					items.map((item) => `\n${inner}${item},`).join(""),
				);
			}
			return;
		}
		const outer = indentAt(code, start(container));
		const inner = `${outer}${style.indent}`;
		if (inside.trim().length === 0) {
			edits.replace(
				start(container),
				end(container),
				`{\n${items.map((item) => `${inner}${item},`).join("\n")}\n${outer}}`,
			);
		} else {
			edits.insert(
				start(container) + 1,
				items.map((item) => `\n${inner}${item},`).join(""),
			);
		}
		return;
	}

	const lineEnd = code.indexOf("\n", end(last));
	const multiline =
		lineOf(code, start(present[0] ?? last)) > lineOf(code, start(container)) &&
		lineEnd !== -1 &&
		lineEnd < end(container);
	if (!multiline) {
		edits.insert(end(last), items.map((item) => `, ${item}`).join(""));
		return;
	}

	const indent = indentAt(code, start(last));
	const trailingComma = /^\s*,/.test(code.slice(end(last), lineEnd));
	if (trailingComma) {
		edits.insert(lineEnd, items.map((item) => `\n${indent}${item},`).join(""));
	} else {
		edits.insert(end(last), ",");
		edits.insert(
			lineEnd,
			items
				.map(
					(item, index) =>
						`\n${indent}${item}${index < items.length - 1 ? "," : ""}`,
				)
				.join(""),
		);
	}
}

/** Adds an item before the first property of an object literal. */
function prependItem(
	edits: TextEdits,
	code: string,
	style: CodeStyle,
	object: Node,
	item: string,
): void {
	const first = (object.properties as Node[])[0];
	if (!first) {
		const inside = code.slice(start(object) + 1, end(object) - 1);
		if (inside.trim().length === 0) {
			edits.replace(start(object), end(object), `{ ${item} }`);
		} else {
			const inner = `${indentAt(code, start(object))}${style.indent}`;
			edits.insert(start(object) + 1, `\n${inner}${item},`);
		}
		return;
	}
	const firstStart = first.leadingComments?.[0]?.start ?? start(first);
	if (lineOf(code, firstStart) > lineOf(code, start(object))) {
		edits.insert(start(object) + 1, `\n${indentAt(code, firstStart)}${item},`);
	} else {
		edits.insert(start(first), `${item}, `);
	}
}
