<h1 align="center">Playwright Intent</h1>

<p align="center">
	<strong>Plain-language Playwright steps, saved as code you can review.</strong>
</p>

<p align="center">
	<a href="https://www.npmjs.com/package/playwright-intent"><img src="https://img.shields.io/npm/v/playwright-intent" alt="npm version" /></a>
	<a href="LICENSE"><img src="https://img.shields.io/npm/l/playwright-intent" alt="license" /></a>
</p>

---

Write Playwright steps in plain language. An agent turns each one into TypeScript once, and every later run replays that code like any other Playwright test.

```ts
import { test } from "playwright-intent";

test("checkout", async ({ page, ai }) => {
	await page.goto("/shop");
	await ai.do("add the cheapest shirt to the cart");
	await ai.do("check out as {email}", { email: "ada@example.com" });
});
```

## How it works

- **Intent:** the text you pass to `ai.do`. Use `{name}` for anything that varies, and pass the values as the second argument.
- **Step:** the TypeScript generated for an intent, saved as a file you can read and review. Changing an intent generates a new step.
- **Agent:** explores the live page and writes the step. It sees your test file and the page it's working on. Values you pass to `ai.do` aren't included in its instructions, but they can reach it through page content once they've been typed or displayed.
- **Store:** where steps live, and whether the agent may change them.

## Quick start

Requires Node 24 and Playwright 1.60 or later.

```bash
npm install -D playwright-intent
```

```ts
// playwright.config.ts
import { defineConfig, type IntentUseOptions } from "playwright-intent";
import { allow, fileStore, refuse } from "playwright-intent/file-store";

export default defineConfig<IntentUseOptions>({
	use: {
		intent: {
			model: "openai/gpt-6-luna",
			store: fileStore({
				changes: { local: allow(), ci: refuse() },
			}),
		},
	},
});
```

Run your tests as usual, with `AI_GATEWAY_API_KEY` set or a provider's model in `model`. Then commit the new `.intent` folder.

## Configuration

Everything lives under `use.intent` in `playwright.config.ts`.

| Option    | Description                                                   |
| --------- | ------------------------------------------------------------- |
| `store`   | Required. Where steps live, and what happens when they change |
| `model`   | The [AI SDK](https://ai-sdk.dev) model used to write steps    |
| `prompts` | Changes what the built-in agent is told                       |
| `context` | Adds your own text to a failure diagnosis                     |
| `limits`  | The agent's `maxTurns` and `timeoutMs`                        |

## Models

`model` takes any [AI SDK](https://ai-sdk.dev) model that supports tool calling. A string goes through Vercel AI Gateway. To use anything else, install its provider and pass the model:

```ts
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({
	apiKey: process.env.OPENROUTER_API_KEY,
});

// In use.intent:
model: openrouter.chat("openai/gpt-6-luna"),
```

For LiteLLM, Ollama, or a company proxy, use an OpenAI-compatible provider:

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const proxy = createOpenAICompatible({
	name: "proxy",
	baseURL: "http://localhost:4000/v1",
	apiKey: process.env.PROXY_API_KEY,
});

// In use.intent:
model: proxy("gpt-6-luna"),
```

Providers that wrap a CLI, like Codex CLI or Claude Code, run their own tools instead of ours, so they won't work.

So far, generated steps have only been tried with `openai/gpt-6-luna`.

## Stores and changes

`fileStore` keeps steps in `.intent` beside your Playwright config. It and the policies below all come from `playwright-intent/file-store`.

A store always needs `changes`, because a change that nobody keeps is lost. A step generated on a CI machine disappears with it, unless you've decided what should happen. `changes` is a policy checked before the agent starts:

- `allow()` lets the agent write missing steps and diagnose failing ones, and leaves its changes on disk for you to review and commit.
- `refuse()` never calls the model. A missing step fails the test, and a failing step fails like any other test.
- `commit()` and `propose()` prove each change on a retry and deliver the proven ones to the pull request. See [Proven changes in CI](#proven-changes-in-ci).

Pass one policy to use it everywhere, or `{ local, ci }` to choose by whether the `CI` environment variable is set:

```ts
fileStore({ changes: { local: allow(), ci: refuse() } });
fileStore({ changes: allow() });
```

A policy can also be your own function, which throws to stop the change. This one writes missing steps, but leaves failures alone:

```ts
fileStore({
	changes: (change) => {
		if (change.type === "diagnose") throw new Error("Failures stay failures.");
	},
});
```

To regenerate steps, delete their files from `.intent`, and the next run writes them again.

`openFileStore(root)` from `playwright-intent/file-store` is the store on its own, for scripts that need to read `.intent` outside a test.

### Proven changes in CI

`commit()` and `propose()` are for CI runs that should produce a fix rather than lose it. A saved change never continues in the same attempt. The attempt fails on purpose, and a retry replays the code from a clean page to prove it.

- With `commit()`, the test passes on the retry and shows as flaky.
- With `propose()`, the test stays red.

Each change uses one retry, so set `retries` to at least the number of steps you expect to break.

On a pull request, the reporter delivers what a run proved. With `commit()` that's one commit on the branch, and the bot's commit needs its CI run approved. With `propose()` it's a comment with a patch to paste.

Model-written code can read the environment of `playwright test`, so delivery only runs under `playwright merge-reports`, in its own job. Have the tests write a `blob` report, and put the reporter in the config you pass to `merge-reports`:

```ts
// merge.config.ts
export default {
	reporter: [["list"], ["playwright-intent/reporter"]],
};
```

```yaml
permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false
      # Install dependencies and browsers, then:
      - run: npx playwright test
        env:
          AI_GATEWAY_API_KEY: ${{ secrets.AI_GATEWAY_API_KEY }}
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: blob-report
          path: blob-report

  deliver:
    needs: test
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    permissions:
      contents: write # For commit()
      pull-requests: write # For propose()
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false
      # Install dependencies, then:
      - uses: actions/download-artifact@v5
        with:
          name: blob-report
          path: blob-report
      - run: npx playwright merge-reports -c merge.config.ts blob-report
        env:
          GITHUB_TOKEN: ${{ github.token }}
```

With sharding, upload one blob report per shard and download them into the same folder.

The reporter takes `{ outputFile }` to also write the run's changes as JSON. Pull requests from forks and Dependabot get a read-only token and no secrets, so both policies act as `refuse()` there.

## Prompts

The built-in agent has two prompts: `generate` writes new steps, and `diagnose` decides what to do after a failure. You can [read them here](playwright-intent/src/agent/prompts.ts), or import them as `defaultPrompts`.

Build on a prompt to teach the agent about your app, and you'll keep getting improvements to the default:

```ts
import { defaultPrompts } from "playwright-intent";

// In use.intent
prompts: {
	generate: `${defaultPrompts.generate}

Dropdowns in this app only open after their label is clicked.`,
},
```

Or pass your own text to replace a prompt completely. The agent's tools stay the same and explain how to use them, so a prompt only needs to say what good work looks like.

Changing a prompt doesn't change steps you've already saved. Delete them from `.intent` to regenerate them, and keep them in Git first.

## Project status

This is early, and the API may change. See [docs/design.md](docs/design.md) for how it works.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and releasing.

## License

[Apache-2.0](LICENSE).

Playwright is a trademark of its respective owner. This project is not affiliated with or endorsed by the Playwright project.

---

<p align="center">Built by</p>
<p align="center">
	<a href="https://endform.dev">
		<picture>
			<source media="(prefers-color-scheme: dark)" srcset="docs/assets/endform-logo-dark.svg" />
			<img src="docs/assets/endform-logo.svg" height="24" alt="Endform" />
		</picture>
	</a>
</p>
