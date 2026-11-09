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

## Storing steps

`use.intent.store` is required, and a store can't be set up without `changes`. A generated step is only useful if something keeps it, and that depends on where the run happens, so nobody should get it by default.

`changes` is one policy, or `{ local, ci }` chosen by the `CI` environment variable. It's a gate: it's checked in the worker just before the agent starts, whether generating or diagnosing. During a diagnosis, the agent may then change nothing at all. Throwing stops the change, so nothing is spent on the model.

- `allow()` lets the agent generate missing steps and diagnose failures, and its changes stay on disk to review and commit.
- `refuse()` never runs the agent. A missing step throws `IntentChangeRejectedError`, and a failing step is an ordinary test failure.
- `commit()` and `propose()` allow the change and leave a record for the reporter. See [Delivering changes](#delivering-changes).

Built-in policies are named values rather than plain functions, so the library knows which one is active and can tell a reporter. A custom function can still decide permission, but it can't deliver anything. One that throws for `diagnose` generates steps and leaves failures alone: the test keeps its own error, and the rejection is reported.

A `{ local, ci }` pair keeps CI from being forgotten. A job that needs something else, like a nightly self-heal, can use plain JS in the config.

Playwright's types make every `use` key optional, so the fixture also throws `IntentConfigError` when `store` is missing.

`fileStore` and the built-in policies have their own entry point, `playwright-intent/file-store`, so they can be used without loading Playwright's test runner. `openFileStore(root)` is the plain store with no policy, which is what the reporter reads with.

## Generating steps

The library owns the browser, cache and limits. An `IntentAgent` observes, runs code through its session, and returns one outcome. Exploration is never saved.

Users choose a model, not an agent. People should be able to bring their plan or provider, but not their own agent loop, so `use.intent.agent` is only a hook for this library's tests.

The built-in agent takes any AI SDK model, so `use.intent.model` can be a provider's model or a Vercel AI Gateway id like `"openai/gpt-6-luna"`. It explores with `run` and `look`, then ends with `finish` or `fail`. Each generation attaches a transcript to the test. Observations list the page's test ids, because the ARIA snapshot doesn't show them.

Everything the model reads is in `src/agent/prompts.ts`. The two prompts, `generate` and `diagnose`, say what good work looks like. They're exported as `defaultPrompts`, and `use.intent.prompts` can extend or replace them. The tools can't change, so how to use them correctly lives in the tool descriptions, where a custom prompt can't remove it. A prompt can't get around the limits the library enforces, but it can produce worse code.

Each task includes the test file as it is on disk, with the line of the current `ai.do`, so the agent can see the hand-written code around a step. The file isn't filtered, so values written in the test reach the model. Secrets belong in environment variables.

| Outcome           | Saved | Test                          |
| ----------------- | ----- | ----------------------------- |
| `solved`, `ready` | Yes   | Continues                     |
| `solved`, `dirty` | Yes   | Fails, and a retry replays it |
| `failed`          | No    | Fails                         |

The first normal replay shows whether a generated step works.

## Regenerating steps

A missing step is generated and a failing one is diagnosed, unless `changes` stops it. To regenerate steps, delete their files from `.intent`, and the next run generates them again.

Configuration lives only in `playwright.config.ts`, under `use.intent`.

## Failures

Retries are the only rewind, because a fixture can't restart a test. Unless `changes` stops it, the agent diagnoses each failure on the live page and returns one decision:

| Decision          | Cache               | Test                           |
| ----------------- | ------------------- | ------------------------------ |
| `repair`, `ready` | Replaces the step   | Continues                      |
| `repair`, `dirty` | Replaces the step   | Fails, and a retry replays it  |
| `regenerate`      | Deletes named steps | Fails, and a retry redoes them |
| `fail`            | No change           | Fails with the diagnosis       |

`use.intent.context` adds text to the diagnosis, like Endform's failure history.

The agent's reasons appear in the run output and as `intent` annotations, and each diagnosis attaches a transcript. If the diagnosis itself fails, the test keeps its own error.

Hitting the turn or time limit, or a model error, says nothing about the app, so the built-in agent ends with a `fail` that names the limit or error. While generating, the test fails with that reason and nothing goes on to diagnose it. During a diagnosis, the test keeps its own error. Either way, no steps change.

The library enforces these limits, whatever the agent asks for:

- `ready` only continues the attempt when nothing in the step could have changed the page before the failure. That's read from the failing line: only assertions may come before it. Otherwise it's treated as `dirty`. Comparing ARIA snapshots doesn't work, because pages keep loading while a step waits.
- `regenerate` can only touch steps that ran in the current test.
- Failures outside a step can't `repair`. They're diagnosed in the fixture's teardown, along with test timeouts inside a step, so these can only prepare the next attempt.

When failures can be diagnosed, a replayed step gets a 15 second action timeout if `use.actionTimeout` isn't set, so a stale locator doesn't use up the whole test timeout.

A repair that changes a step's assertions is listed in the run output, but isn't blocked.

## Delivering changes

With `allow()` or `refuse()` none of this happens: there are no records, and no test fails on purpose.

In CI, `refuse()` stays red until someone reruns locally, and `allow()` goes green on code nobody reviewed that's lost with the machine. `commit()` and `propose()` make CI produce a fix someone can review.

Saved changes follow the same rule as any other run: `ready` carries on in the same attempt, and `dirty` fails it so a retry can replay from a clean page. A change is delivered if its test ended up passing. Its code may not have been replayed as a whole yet, so the next CI run on the branch is what replays it.

| Policy      | Once the test passes                          | Run                    |
| ----------- | --------------------------------------------- | ---------------------- |
| `commit()`  | Nothing more. It's flaky if it needed a retry | Green                  |
| `propose()` | The fixture's teardown fails the attempt      | Red until it's applied |

The worker attaches an `intent-change` record for each write, delete and diagnosis. A write's record includes the step's source, so the report alone carries a run's changes. The delivery job doesn't need `.intent` restored, and a shard's out-of-date copy can't replace another shard's fix. `delivery` is in the record because a reporter under `merge-reports` can't read `use.intent`.

For `propose()`, a marker in the project's output folder records that the test saved a change, because a retry is a new process. That tells a passing retry from a normal flaky test. The first attempt clears it, so nothing carries over between runs. An attempt that passed and was failed on purpose attaches `intent-passed`, so the reporter knows it passed, and any retries left fail straight away.

An attempt only gets one diagnosis, so each broken step past the first needs a retry, as does anything `dirty`. A test that runs out of retries fails, and its changes are left out.

### The reporter

```ts
reporter: [["list"], ["playwright-intent/reporter"]],
```

Gathering a run's fixes needs something that sees every test. A reporter is the only hook that works on plain Playwright, sharded CI and Endform: `globalTeardown` runs before results exist, and Endform removes it on lambdas. `playwright merge-reports` runs reporters too, so sharded CI gets one set of changes. Playwright's plugin hook, `config["@playwright/test"].plugins`, is private and wouldn't run under `merge-reports`.

It's an explicit line, and only `commit()` and `propose()` need it. The fixture doesn't check for it, because a sharded run's reporter is in the merge job.

- A change counts as passed when an attempt saved it and that attempt or a later one of the same test passed.
- Browser projects share steps, so a file that a failed test also wrote is left out.
- Only keys inside `.intent` count. Records come from workers that run model-written code.
- Repository paths come from `config.configFile`, which `merge-reports` sets from `-c`.

The reporter prints the changes from passing and failing tests, and the diagnoses. With `{ outputFile }` it also writes them as JSON on every run.

### Delivering through GitHub

On a `pull_request` run in GitHub Actions, the reporter delivers the changes from passing tests:

- `commit()` creates one commit on the pull request's head through the API. A `pull_request` run checks out a merge commit, so a plain `git push` would push the wrong thing. If the head has moved since the tests ran, nothing is committed.
- `propose()` keeps one comment up to date, describing each fix above a collapsed patch built as a `git diff` against the pull request's head. Inline suggestions won't work, because the broken step file usually isn't in the pull request's diff. Failures the agent left alone are listed there too, and when a later run has nothing to propose the comment says so.

| Policy      | `permissions:`         | Notes                                      |
| ----------- | ---------------------- | ------------------------------------------ |
| `propose()` | `pull-requests: write` | Nothing lands until a person applies it    |
| `commit()`  | `contents: write`      | The bot's commit needs its CI run approved |

A run delivers from the job that ran the tests, so a single job with the permissions above and `GITHUB_TOKEN` is enough. One shard only sees part of a run, so it never delivers. Sharded runs, and Endform's CI job, deliver from `playwright merge-reports`, with the reporter in the config passed to `-c`.

Pull requests from forks and Dependabot get a read-only token and no secrets, so both policies act as `refuse()` there.

## Defaults taken for the MVP

- `ai.do` returns nothing. Hand-written Playwright reads values from the page.
- Generation asks for a closing assertion in every step, but doesn't enforce it.
- Agent limits are 30 turns and 3 minutes.
- Support is Node 24 and Playwright `>=1.60`.

## Later

See [open-questions.md](open-questions.md) for postponed questions, and [step-quality.md](step-quality.md) for what trials showed about the agent's code. Also postponed:

- `cache-api`, remote stores, branch handling and review flows. Retries read what a run just generated, so a shared remote store needs a way to hold changes until they're accepted.
- Sharing steps between tests, and separate caches per browser project.
- Pruning orphaned files, and letting steps import helpers.
- A CLI, a summary reporter, and type-checking step files.
- `ai.expect`.
- Sending screenshots to OpenAI-compatible providers. By default they stringify tool results, so `look` would send base64 text unless `supportsMultiPartToolContent` is set.
- Parallel tool calls on providers other than OpenAI, where a model could call `run` and `finish` in the same turn.
- Replacing a step mid-process. Node caches each import, so a test that repeats in the same worker after a repair, with `--repeat-each`, replays the old code until the next process.

### Using a ChatGPT plan

Users could generate steps on their ChatGPT plan instead of an API key, through OpenAI's [Sign in with ChatGPT for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source). This is a preview, and it needs a test against a real account before we commit to it.

- **API:** add `chatgptPlan("gpt-6-luna")` as an optional `playwright-intent/chatgpt` entry point, plus `npx playwright-intent login`. It returns a normal AI SDK model, so nothing else in the library changes.
- **Not `backend-api`:** OpenAI says not to call it, so don't copy the Codex-client approach used by `e2e`. Call `https://api.openai.com/v1/responses`. `@earendil-works/pi-ai` is a good MIT reference for the login flow.
- **Requests:** `@ai-sdk/openai` may need a custom `fetch` to meet the preview's rules: `store: false`, `stream: true`, no `system` role, namespaced or `additional_tools` tools, and no `max_output_tokens` or `temperature`.
- **Tokens:** refresh tokens rotate, so refreshes need a lock across Playwright workers.
- **Scope:** it covers open-source, locally hosted use. Hosted Endform needs OpenAI's [interest form](https://openai.com/form/sign-in-with-chatgpt-interest/), and CI should keep using API keys.
