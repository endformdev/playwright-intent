# Agent Guidelines for playwright-intent

Always typecheck from workspace root: `pnpm tsc`
Always run unit tests from workspace root: `pnpm test`
Never make types.ts files.
Run the e2e flows from `playwright-intent/`: `pnpm test:e2e`. These are the main tests, see `playwright-intent/test-e2e/README.md`.
