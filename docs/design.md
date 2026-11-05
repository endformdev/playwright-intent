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

The built-in agent takes any AI SDK model, so `use.intent.model` can be a provider's model or a Vercel AI Gateway id like `"openai/gpt-6-luna"`. It explores with `run` and `look`, then ends with `finish` or `give_up`. Each generation attaches a transcript to the test. Observations list the page's test ids, because the ARIA snapshot doesn't show them.

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

The agent's reasons appear in the run output and as `intent` annotations, and each diagnosis attaches a transcript. If the diagnosis itself fails, the test keeps its own error.

The library enforces these limits, whatever the agent asks for:

- `ready` only continues the attempt when nothing in the step could have changed the page before the failure. That's read from the failing line: only assertions may come before it. Otherwise it's treated as `dirty`. Comparing ARIA snapshots doesn't work, because pages keep loading while a step waits.
- `regenerate` can only touch steps that ran in the current test.
- Failures outside a step can't `repair`. They're diagnosed in the fixture's teardown, along with test timeouts inside a step, so these can only prepare the next attempt.

`.intent/.failed/<step>.json` keeps the old code and error, which the next generation receives as `previousFailure`. It's removed once the step has been generated again. In `changed` mode, a replayed step gets a 15 second action timeout if `use.actionTimeout` isn't set, so a stale locator doesn't use up the whole test timeout.

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
- Replacing a step mid-process. Node caches each import, so a test that repeats in the same worker after a repair, with `--repeat-each`, replays the old code until the next process.

### Using a ChatGPT plan

Users could generate steps on their ChatGPT plan instead of an API key, through OpenAI's [Sign in with ChatGPT for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source). This is a preview, and it needs a test against a real account before we commit to it.

- **API:** add `chatgptPlan("gpt-6-luna")` as an optional `playwright-intent/chatgpt` entry point, plus `npx playwright-intent login`. It returns a normal AI SDK model, so nothing else in the library changes.
- **Not `backend-api`:** OpenAI says not to call it, so don't copy the Codex-client approach used by `e2e`. Call `https://api.openai.com/v1/responses`. `@earendil-works/pi-ai` is a good MIT reference for the login flow.
- **Requests:** `@ai-sdk/openai` may need a custom `fetch` to meet the preview's rules: `store: false`, `stream: true`, no `system` role, namespaced or `additional_tools` tools, and no `max_output_tokens` or `temperature`.
- **Tokens:** refresh tokens rotate, so refreshes need a lock across Playwright workers.
- **Scope:** it covers open-source, locally hosted use. Hosted Endform needs OpenAI's [interest form](https://openai.com/form/sign-in-with-chatgpt-interest/), and CI should keep using API keys.
