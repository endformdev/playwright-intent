# Contributing to playwright-intent

## Prerequisites

- Node.js 24
- [pnpm](https://pnpm.io) (see `packageManager` in `package.json` for the exact version)

## Setup

```bash
git clone https://github.com/endformdev/playwright-intent.git
cd playwright-intent
pnpm install
```

## Repository layout

This is a pnpm workspace. Each package lives in a top-level directory:

- `playwright-intent/` — the `playwright-intent` package
- `cache-api/` — `@playwright-intent/cache-api`, the API `remoteStore` talks to
- `animations/` — the README's animations, private and unpublished. See [its README](animations/README.md)

Additional packages are published under the `@playwright-intent/` npm scope. To add one, create a top-level directory, add it to `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`, the `release` script in `package.json` and the filters in `.github/workflows/release.yml`.

## Testing

The dogfood flows in [`playwright-intent/test-e2e`](playwright-intent/test-e2e/README.md) are the main tests. Install a browser first with `pnpm --filter ./playwright-intent exec playwright install chromium`.

The remote store flows run a local cache API over a folder. To run them against a real bucket instead, set `INTENT_E2E_S3_BUCKET`, `INTENT_E2E_S3_ENDPOINT`, `INTENT_E2E_S3_ACCESS_KEY_ID`, `INTENT_E2E_S3_SECRET_ACCESS_KEY` and, for anything but R2, `INTENT_E2E_S3_REGION`. Each flow writes under its own `e2e-*` prefix, and nothing deletes them.

## Root-level commands

- `pnpm test` runs the unit tests (vitest)
- `pnpm --filter ./playwright-intent test:e2e` builds and runs the dogfood e2e flows
- `pnpm tsc` typechecks all packages
- `pnpm format` formats files with oxfmt
- `pnpm lint` lints with oxlint
- `pnpm build` builds all packages

## Releasing

```bash
pnpm release
```

This bumps all packages to the same version, commits, tags, and pushes to trigger the publish workflow, which publishes to npm via trusted publishing.

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 license](LICENSE).
