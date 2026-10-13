import { expect, test } from "vitest";
import { name } from "./index";

test("exports the package name", () => {
	expect(name).toBe("pw-ai");
});
