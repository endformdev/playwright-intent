---
title: Models
description: Use any AI SDK model that supports tool calling, through Vercel AI Gateway or your own provider.
sidebar:
  order: 2
---

The agent writes steps with the model you set in `model`.

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
