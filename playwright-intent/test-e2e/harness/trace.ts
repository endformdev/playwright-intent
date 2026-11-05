import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface TraceAction {
	title: string;
	file: string;
	line: number;
}

export interface TraceContents {
	/** Browser actions and steps, with the source line each one points to. */
	actions: TraceAction[];
	/** Source files embedded in the trace, for the viewer's source tab. */
	sources: string[];
}

export function readTrace(zipPath: string): TraceContents {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "intent-trace-"));
	try {
		execFileSync("unzip", ["-q", "-o", zipPath, "-d", directory]);

		const events = fs
			.readdirSync(directory)
			.filter((file) => file.endsWith(".trace"))
			.flatMap((file) =>
				fs
					.readFileSync(path.join(directory, file), "utf8")
					.split("\n")
					.filter(Boolean)
					.map((line) => JSON.parse(line)),
			);

		const actions = events
			.filter((event) => event.type === "before" && event.stack?.[0])
			.map((event) => ({
				title: event.title ?? event.method ?? "",
				file: path.basename(event.stack[0].file),
				line: event.stack[0].line,
			}));

		// The layout differs by version: `src/` now, `resources/src@*` on 1.60.
		const sources = fs
			.readdirSync(directory, { recursive: true, encoding: "utf8" })
			.filter((file) => /(^|\/)src[/@]/.test(file))
			.map((file) => path.join(directory, file))
			.filter((file) => fs.statSync(file).isFile())
			.map((file) => fs.readFileSync(file, "utf8"));

		return { actions, sources };
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
}
