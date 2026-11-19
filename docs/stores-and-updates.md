---
title: Stores and updates
description: Where steps live, whether the agent may change them, and how its changes reach your repository.
sidebar:
  order: 3
---

A store decides where steps live, and whether the agent may change them.

`fileStore` keeps steps in `.intent` beside your Playwright config, for you to commit. It and the policies below all come from `playwright-intent/file-store`. To keep steps out of Git and share them between CI runs instead, see [Sharing steps through a remote store](#sharing-steps-through-a-remote-store).

A store always needs `updates`, because a change that nobody keeps is lost. A step generated on a CI machine disappears with it, unless you've decided what should happen. `updates` decides whether the agent may change steps, and what keeps its changes:

- `allow()` lets the agent write missing steps and diagnose failing ones, and leaves its changes on disk for you to review and commit.
- `refuse()` never calls the model. A missing step fails the test, and a failing step fails like any other test.
- `commit()` and `propose()` let the agent make changes and deliver them to the pull request. See [Regenerating intent steps in CI](#regenerating-intent-steps-in-ci).

Pass one policy to use it everywhere, or `{ local, ci }` to choose by whether the `CI` environment variable is set:

```ts
fileStore({ updates: { local: allow(), ci: refuse() } });
fileStore({ updates: allow() });
```

To regenerate steps, delete their files from `.intent`, and the next run writes them again.

`openFileStore(root)` from `playwright-intent/file-store` is the store on its own, for scripts that need to read `.intent` outside a test.

## Regenerating intent steps in CI

`commit()` and `propose()` are for CI runs that should produce a fix rather than lose it. The agent works as it does anywhere else, and the reporter delivers the changes from tests that end up passing:

- `commit()` adds one commit to the pull request, and the test passes. The bot's commit needs its CI run approved.
- `propose()` leaves a comment with a patch to paste, and the test stays red until it's applied.

The reporter needs the same options as `use.intent`, as in the [quick start](../README.md#quick-start). Keep `retries` at 1 or more, because the agent sometimes needs a clean page to carry on from:

```ts
const intent = {
	model: "openai/gpt-6-luna",
	store: fileStore({ updates: { local: allow(), ci: commit() } }),
} satisfies IntentOptions;

export default defineConfig<IntentUseOptions>({
	retries: 1,
	reporter: [["list"], ["playwright-intent/reporter", intent]],
	use: { intent },
});
```

Then give the job that runs your tests permission to deliver:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: write # For commit()
      pull-requests: write # For propose()
    steps:
      - uses: actions/checkout@v5
      # Install dependencies and browsers, then:
      - run: npx playwright test
        env:
          AI_GATEWAY_API_KEY: ${{ secrets.AI_GATEWAY_API_KEY }}
          GITHUB_TOKEN: ${{ github.token }}
```

Sharded runs deliver from `playwright merge-reports` instead. See [the design notes](design.md#delivering-through-github).

Pull requests from forks and Dependabot get a read-only token and no secrets, so both policies act as `refuse()` there.

## Sharing steps through a remote store

`remoteStore` keeps steps in [`@playwright-intent/cache-api`](../cache-api/README.md), which you deploy on any S3-compatible storage, like Cloudflare R2. CI runs share the steps through it, so nothing is committed:

```ts
import { remoteStore, shared } from "playwright-intent/remote-store";

const intent = {
	model: "openai/gpt-6-luna",
	store: remoteStore({
		url: "https://intent-cache.example.com",
		token: process.env.INTENT_CACHE_TOKEN,
		updates: shared(),
	}),
} satisfies IntentOptions;

export default defineConfig<IntentUseOptions>({
	retries: 1,
	reporter: [["list"], ["playwright-intent/reporter", intent]],
	use: { intent },
});
```

The reporter is required. It downloads the stored steps into `.intent` before any test starts, and uploads the run's changes at the end.

- Every run downloads the steps once. If a test's folder is already in `.intent`, what's on disk is used, so your local work wins. Delete a test's folder to download it again, and add `.intent` to `.gitignore`.
- The agent can always change steps. Runs with the `CI` environment variable set upload the changes from tests that end up passing, and local runs never upload.
- `shared()` means every branch reads and writes the same steps. When two runs upload at once, the last one wins, and the steps it overwrote are generated again on a later run.
- If the steps can't be downloaded, every test fails, rather than regenerating all of them.
- Sharded runs upload from `playwright merge-reports`, with the reporter in the config passed to `-c`.
- Pull requests from forks and Dependabot get no secrets, so they never upload. They can only download if your API lets them read without a token.

Pass the token to the job that runs your tests:

```yaml
- run: npx playwright test
  env:
    AI_GATEWAY_API_KEY: ${{ secrets.AI_GATEWAY_API_KEY }}
    INTENT_CACHE_TOKEN: ${{ secrets.INTENT_CACHE_TOKEN }}
```
