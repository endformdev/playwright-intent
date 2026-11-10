import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { RunChange } from "../src/reporter/change-set";
import {
	applyChanges,
	readStepZip,
	testFolder,
	writeStepZip,
} from "../src/remote-store/step-zip";

const ADD = "tests/cart.spec.ts/cart - adds/add a shirt.ts";
const PAY = "tests/cart.spec.ts/cart - adds/pay.ts";

function change(key: string, source?: string): RunChange {
	return {
		key,
		kind: source === undefined ? "delete" : "write",
		cause: "generate",
		...(source !== undefined && { source }),
		tests: ["cart"],
	};
}

describe("step zips", () => {
	it("round-trips step files", () => {
		const files = new Map([
			[ADD, "// add"],
			[PAY, "// pay ✓"],
		]);

		expect(readStepZip(writeStepZip(files))).toEqual(files);
	});

	it("skips entries that would land outside .intent", () => {
		const zip = zipSync({
			[ADD]: strToU8("// add"),
			"../escape.ts": strToU8("bad"),
			"/absolute.ts": strToU8("bad"),
			"tests/": new Uint8Array(),
		});

		expect([...readStepZip(zip).keys()]).toEqual([ADD]);
	});

	it("writes and deletes changes on top of what was stored", () => {
		const stored = new Map([
			[ADD, "// old add"],
			[PAY, "// pay"],
		]);

		const next = applyChanges(stored, [change(ADD, "// new add"), change(PAY)]);

		expect(next).toEqual(new Map([[ADD, "// new add"]]));
		expect(stored.get(ADD)).toBe("// old add");
	});

	it("finds a step's test folder", () => {
		expect(testFolder(ADD)).toBe("tests/cart.spec.ts/cart - adds");
	});
});
