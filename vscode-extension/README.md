# Playwright Intent for VS Code

Go from an `ai.do` intent to the step it runs.

- **Cmd+click** (Ctrl+click) on an intent opens its step in `.intent`.
- **Hover** over an intent or its `do` to see the step's code.

It works with any TypeScript version and needs no setup. See [Playwright Intent](https://github.com/endformdev/playwright-intent) for the library.

The extension finds a step from the titles of the `test` and `test.describe` calls around it. When those aren't string literals, as in a loop, or when `ai.do` is called from a helper, it offers every step with the same intent instead.
