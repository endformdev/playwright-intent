import { expect, test, vi } from "vitest";
import { IntentChangeRejectedError } from "../src/errors";
import {
	allow,
	type Changes,
	commit,
	deliveryOf,
	propose,
	refuse,
	resolveChangePolicy,
	type StepChange,
} from "../src/store/changes";

const change: StepChange = {
	type: "generate",
	test: "checkout",
};
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

test.each([commit, propose])("%o lets the change through", (policy) => {
	expect(() => policy().check(change)).not.toThrow();
});

test("only commit and propose deliver changes", () => {
	expect(deliveryOf(commit())).toBe("commit");
	expect(deliveryOf(propose())).toBe("propose");
	expect(deliveryOf(allow())).toBeNull();
	expect(deliveryOf(refuse())).toBeNull();
});
