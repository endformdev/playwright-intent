---
title: Configuration
description: The options that tell Playwright Intent where steps live and how the agent works.
sidebar:
  order: 1
---

Playwright Intent takes one options object in `playwright.config.ts`.

The intent options go to both `use.intent` and `playwright-intent/reporter`, so tests and the reporter agree on where steps go. Define them once, as in the [quick start](../README.md#quick-start).

| Option    | Description                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| `store`   | Required. Where steps live, and how the agent's changes are kept. See [Stores and updates](stores-and-updates.md) |
| `model`   | The [AI SDK](https://ai-sdk.dev) model used to write steps. See [Models](models.md)                               |
| `prompts` | Changes what the built-in agent is told. See [Prompts](prompts.md)                                                |
| `context` | Adds your own text to a failure diagnosis                                                                         |
| `limits`  | The agent's `maxTurns` and `timeoutMs`                                                                            |
