# Dogfood end-to-end tests

These tests are the main way we check `playwright-intent`.

`project/` is a small, real Playwright project that tests a shop using `playwright-intent`, the way a user would. Each test in `flows/` copies it to a temporary workspace, starts one or more real `playwright test` runs, and checks what came out.

## Why flows run Playwright inside Playwright

Most of what we care about can't be checked from inside the test it happens in:

- Tests fail on purpose, and a failing test can't assert that it failed correctly.
- A retry runs in a new worker process, so nothing in memory survives to check it.
- Whether steps may change comes from the environment, so it's fixed for a whole run.
- Most behaviour only shows across runs: generate in one, replay in the next.

So the unit of testing is a run, and a flow is a sequence of runs.

## Forcing each case

Every case is forced with one of five levers, so no flow depends on timing or luck:

| Lever     | How                                            | Forces                                                                  |
| --------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| The agent | `project.scriptAgent()`                        | Every outcome: solved, dirty, failed, and each failure decision         |
| The app   | `project.run({ shop })`                        | Stale steps, redesigns and real bugs, by changing the shop between runs |
| The tests | `project.replaceInFile()`                      | Reworded intents, renamed tests, moved steps                            |
| The run   | `project.run({ retries, ci, updates, shard })` | Retries, CI, update policies and sharding                               |
| The cache | `project.writeStep()`                          | Corrupted or conflicting step files                                     |

The usual pattern mirrors real life: generate against the `baseline` shop, change the shop, then run again.

The scripted agent replaces the model at the `IntentAgent` boundary, so the real browser, cache, loader and retries all run. An agent call with no script fails loudly, which is how flows prove the model wasn't called.

## What flows check

Only things a user could see from the outside:

- Exit code, and each test's outcome and attempts, from the JSON reporter.
- The files in `.intent`.
- Every agent call, including exactly what the agent was told.
- Trace contents: action lines and embedded sources.
- What the reporter collected: its output, and the change set it writes.

## Layout

```text
test-e2e/
├── flows/      What should happen, grouped by behaviour
├── harness/    Creates workspaces, runs Playwright, reads results
└── project/    The dogfood project that gets copied and run
```

`test.fixme` flows are the agreed design that isn't built yet.

## Running

```bash
pnpm test:e2e                     # builds, then runs every flow
pnpm playwright test generate     # one suite, after a build
```

A failed flow keeps its workspace in `test-e2e/.workspaces/`, so you can open it or run it by hand with `npx playwright test`.
