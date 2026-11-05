# Design

`playwright-intent` turns natural-language steps into TypeScript. The first run generates the code with an agent. Later runs replay it as normal Playwright code, so it's deterministic, reviewable, and visible in traces.

```ts
import { test } from "playwright-intent";

test("checkout", async ({ page, ai }) => {
	await page.goto("/shop");
	await ai.do("add the cheapest shirt to the cart");
	await ai.do("check out as {email}", { email });
});
```

## Step files

A step's path is a literal translation of where it's called from, with no hashes or lockfile:

```text
.intent/tests/checkout/cart.spec.ts/cart - guest checkout/fill out the checkout.ts
```

`.intent` sits beside the Playwright config. Each file's header holds the exact intent and test:

- A changed intent is a cache miss.
- A different test is a loud error, because two titles collided.
- Two sanitized names that match in one test are also a loud error.

Steps receive `{ page, context, request, expect, vars }` and may only use `import type`, so changes to other helpers can't break them.

## Running steps

Playwright's Babel transform shifts line numbers, and it can't map them back for files imported during a test. A `registerHooks` load hook takes over `.intent/*.ts`, and `stripTypeScriptTypes` removes types without moving any lines.

Code always runs from disk, because Playwright reads the file for snippets and trace sources. A remote store fills `.intent` just before each import.

## Generating steps

The library owns the browser, cache and limits. An `IntentAgent` observes, runs code through its session, and returns one outcome. Exploration is never saved.

Each task includes the test file as it is on disk, with the line of the current `ai.do`, so the agent can see the hand-written code around a step. The file isn't filtered, so values written in the test reach the model. Secrets belong in environment variables.

| Outcome           | Saved | Test                          |
| ----------------- | ----- | ----------------------------- |
| `solved`, `ready` | Yes   | Continues                     |
| `solved`, `dirty` | Yes   | Fails, and a retry replays it |
| `failed`          | No    | Fails                         |

The first normal replay proves a generated step works.

## Modes

| Mode      | Cache miss | Cached step fails |
| --------- | ---------- | ----------------- |
| `none`    | Fail       | Fail              |
| `missing` | Generate   | Fail              |
| `changed` | Generate   | Agent diagnoses   |
| `all`     | Regenerate | Regenerate        |

Configuration lives only in `playwright.config.ts`, under `use.intent`. `PW_INTENT` overrides the mode for one run. With neither set, the mode is `none` in CI and `missing` elsewhere.

## Failures

Retries are the only rewind, because a fixture can't restart a test. In `changed` mode the agent diagnoses each failure on the live page and returns one decision:

| Decision          | Cache                                  | Test                           |
| ----------------- | -------------------------------------- | ------------------------------ |
| `repair`, `ready` | Replaces the step                      | Continues                      |
| `repair`, `dirty` | Replaces the step                      | Fails, and a retry replays it  |
| `regenerate`      | Moves named steps to `.intent/.failed` | Fails, and a retry redoes them |
| `rerun`           | No change                              | Fails                          |
| `fail`            | No change                              | Fails with the diagnosis       |

`use.intent.context` adds text to the diagnosis, like Endform's failure history.

The library enforces these limits, whatever the agent asks for:

- `ready` needs an unchanged ARIA snapshot. Otherwise it's treated as `dirty`.
- `regenerate` can only touch the current test's steps.

A repair that changes a step's assertions is listed in the run output, but isn't blocked.

## Defaults taken for the MVP

- `ai.do` returns nothing. Hand-written Playwright reads values from the page.
- Generation asks for a closing assertion in every step, but doesn't enforce it.
- Agent limits are 30 turns and 3 minutes.
- Support is Node 24 and Playwright `>=1.60`.

## Later

See [open-questions.md](open-questions.md) for postponed questions. Also postponed:

- `cache-api`, remote stores, branch handling and review flows.
- Sharing steps between tests, and separate caches per browser project.
- Pruning orphaned files, and letting steps import helpers.
- A CLI, a summary reporter, `-u` integration, and type-checking step files.
- `ai.expect`, diagnosis in CI, and external agents.
