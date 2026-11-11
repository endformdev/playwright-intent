const KEYWORDS = new Set([
	"as",
	"async",
	"await",
	"const",
	"default",
	"export",
	"from",
	"function",
	"import",
	"new",
	"return",
	"satisfies",
	"type",
]);

const LITERALS = new Set(["true", "false", "null", "undefined"]);

const TOKEN =
	/(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|([A-Za-z_$][\w$]*)|(\d+(?:_\d+)*)|(\s+)|(.)/g;

/** Highlights one line of TypeScript as HTML. Good enough for slides. */
export function highlight(code: string): string {
	let out = "";
	for (const match of code.matchAll(TOKEN)) {
		const [text, comment, string, word, number, space] = match;
		const rest = code.slice((match.index ?? 0) + text.length);
		if (comment) out += span("c", text);
		else if (string) out += span("s", text);
		else if (word && KEYWORDS.has(word)) out += span("k", text);
		else if (word && LITERALS.has(word)) out += span("n", text);
		else if (word && /^\s*[(<]/.test(rest)) out += span("f", text);
		else if (word && /^[A-Z]/.test(word)) out += span("t", text);
		else if (word) out += span("v", text);
		else if (number) out += span("n", text);
		else if (space) out += text;
		else out += span("p", text);
	}
	return out;
}

function span(kind: string, text: string): string {
	return `<span class="tok-${kind}">${escape(text)}</span>`;
}

export function escape(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
