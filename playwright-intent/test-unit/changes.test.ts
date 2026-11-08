import { expect, test, vi } from "vitest";
import { IntentChangeRejectedError } from "../src/errors";
import {
	allow,
	type Changes,
	refuse,
	resolveChangePolicy,
	type StepChange,
} from "../src/store/changes";

const change: StepChange = { type: "generate", test: "checkout" };
const pair: Changes = { local: allow(), ci: refuse() };

test("a pair picks by the CI variable", () => {
	expect(resolveChangePolicy(pair, {}).name).toBe("allow");
	expect(resolveChangePolicy(pair, { CI: "true" }).name).toBe("refuse");
});

test("a single policy applies everywhere", () => {
	expect(resolveChangePolicy(allow(), {}).name).toBe("allow");
	expect(resolveChangePolicy(allow(), { CI: "true" }).name).toBe("allow");
});

test("allow lets the change through", () => {
	expect(() => allow().check(change)).not.toThrow();
});

test("refuse throws", () => {
	expect(() => refuse().check(change)).toThrow(IntentChangeRejectedError);
});

test("a custom function decides permission under the name custom", () => {
	const check = vi.fn();

	const policy = resolveChangePolicy({ local: check, ci: refuse() }, {});
	policy.check(change);

	expect(policy.name).toBe("custom");
	expect(check).toHaveBeenCalledWith(change);
});
