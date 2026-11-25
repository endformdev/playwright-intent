---
title: Setup
description: Set up Playwright Intent in an existing Playwright project with one command.
sidebar:
  order: 0
---

`playwright-intent init` sets up Playwright Intent in a Playwright project, including one you've just created with `npm init playwright@latest`:

```bash
npx playwright-intent@latest init
```

`npm init playwright-intent@latest` runs the same command.

## What it changes

- Installs `playwright-intent`.
- Adds the intent options to `playwright.config.ts`, passes them to `use.intent` and to the reporter, and loads `.env` from the config's folder with Node's `process.loadEnvFile`. The rest of the config stays as it is.
- Switches every import of `test` from `@playwright/test` to `playwright-intent`. `playwright-intent` re-exports everything from Playwright, so tests that don't call `ai.do` work as before.
- Adds `.env` to `.gitignore`.

When it's done, it lists what it changed and anything left for you, like adding `AI_GATEWAY_API_KEY` to `.env`. If the repository has a `.vscode` folder, it also says how to recommend the [VS Code extension](editor-support.md). Running it again only does what's still missing, so it also checks a setup.

It reads the config and tests with the parser Playwright itself uses. If that can't be loaded, it still installs `playwright-intent` and updates `.gitignore`, and lists the config and the files to change under what's left for you.

## Fixtures

Suites keep their own fixtures. In a fixtures file built with `base.extend`, only the import changes, and the tests that import from that file are left alone. Layered fixtures and `mergeTests` work the same way, because every file that starts from Playwright's `test` starts from `playwright-intent`'s instead.

Two cases are left for you:

- If a fixture or option is already called `ai` or `intent`, `init` stops before writing anything, and names the file and line. Rename it, then run `init` again.
- If tests take `test` from a package, like a shared one in a monorepo, that package needs the change. Or extend its `test` where you import it, with `createIntentTest(base)` from `playwright-intent`.

Component tests aren't changed.

## Running it from an agent or a script

`init` only asks questions in a terminal. When a coding agent or a script runs it, it uses the defaults and never waits for input. If it can't choose safely, like between two configs, it stops without changing anything and prints the command to run next.

The key is never an option. Without a terminal, `init` reads `AI_GATEWAY_API_KEY` from the environment or `.env`, so the key stays out of transcripts and shell history.

| Option            | Description                                                                          |
| ----------------- | ------------------------------------------------------------------------------------ |
| `--config <path>` | The Playwright config to set up, when there's more than one                          |
| `--model <id>`    | The Vercel AI Gateway model, `openai/gpt-6-luna` by default. See [Models](models.md) |
| `--dry-run`       | Lists the changes, and writes nothing                                                |
| `--no-install`    | Prints the install command instead of running it                                     |
| `--no-rewrite`    | Leaves imports in test files alone                                                   |
| `--yes`           | Doesn't ask questions, even in a terminal                                            |
