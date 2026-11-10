# @playwright-intent/cache-api

[![npm version](https://img.shields.io/npm/v/@playwright-intent/cache-api)](https://www.npmjs.com/package/@playwright-intent/cache-api)
[![license](https://img.shields.io/npm/l/@playwright-intent/cache-api)](https://github.com/endformdev/playwright-intent/blob/main/LICENSE)

H3-based API library for sharing [Playwright Intent](https://github.com/endformdev/playwright-intent) steps through S3-compatible object storage, like Cloudflare R2 or AWS S3.

`remoteStore` from `playwright-intent/remote-store` talks to it. See [Sharing steps through a remote store](../README.md#sharing-steps-through-a-remote-store).

## Installation

```bash
npm install @playwright-intent/cache-api
```

## Introduction

The API stores one zip of step files per scope, and serves it back. It doesn't read the zips, so it's a thin layer between Playwright runs and your bucket. The bucket's credentials stay on the server, and runs only need a token for the API.

It runs on Cloudflare Workers, Deno, Bun, Node.js, or anywhere else with web-standard `Request` and `Response` handlers.

## Usage

### Cloudflare Workers

Bind an R2 bucket to the Worker, and pass the binding to `createR2Storage`, so the Worker needs no S3 credentials:

```jsonc
// wrangler.jsonc
{
	"r2_buckets": [{ "binding": "STEPS", "bucket_name": "intent-steps" }],
}
```

`createCacheApi` doesn't authenticate requests, so add your own middleware in front of the handler. This one accepts one bearer token, set with `wrangler secret put CACHE_TOKEN`:

```typescript
import { defineMiddleware, H3, HTTPError } from "h3";
import {
	createR2Storage,
	createZipsHandler,
	type R2BucketBinding,
	ZIPS_PATH,
} from "@playwright-intent/cache-api";

interface Env {
	STEPS: R2BucketBinding;
	CACHE_TOKEN: string;
}

export default {
	fetch(request: Request, env: Env) {
		const storage = createR2Storage(env.STEPS);

		const app = new H3();
		app.use(
			ZIPS_PATH,
			defineMiddleware((event) => {
				const header = event.req.headers.get("authorization");
				if (header !== `Bearer ${env.CACHE_TOKEN}`) {
					throw new HTTPError({ status: 401, message: "Unauthorized" });
				}
			}),
		);
		app.get(ZIPS_PATH, createZipsHandler({ storage }));
		app.put(ZIPS_PATH, createZipsHandler({ storage }));
		return app.fetch(request);
	},
};
```

Use [`resolvePath`](#configuration) to give each team or project its own folder in one bucket, for example by the token they authenticated with.

### Node.js

```typescript
import { serve } from "h3/node";
import { createCacheApi } from "@playwright-intent/cache-api";

const api = createCacheApi({
	storageConfig: {
		bucket: "intent-steps",
		endpoint: "https://s3.eu-north-1.amazonaws.com",
		accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
		secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
		region: "eu-north-1",
	},
});

serve(api, { port: 3000 });
```

To keep zips in a folder on one server instead, use `createFileSystemStorage` from `@playwright-intent/cache-api/file-system`:

```typescript
import { createFileSystemStorage } from "@playwright-intent/cache-api/file-system";

const api = createCacheApi({ storage: createFileSystemStorage("./steps") });
```

## API Reference

### Configuration

```typescript
interface CacheApiConfig {
	storage?: CacheApiStorage;
	storageConfig?: {
		bucket: string;
		endpoint: string;
		accessKeyId: string;
		secretAccessKey: string;
		region?: string; // Default: 'auto', which works for R2
	};
	resolvePath?: (event: H3Event, path: string) => Promise<string> | string;
	corsOrigin?: string | false;
}
```

Provide either `storage`, or `storageConfig` to create the built-in S3-compatible storage. `storage` can be `createR2Storage(binding)`, `createS3Storage(config)`, `createFileSystemStorage(directory)`, or your own `CacheApiStorage`. `resolvePath` changes each storage path before it's read or written. `corsOrigin` defaults to `false`, and runs don't need it.

### Endpoints

```
GET /v1/zips/main
PUT /v1/zips/main
Content-Type: application/zip
```

Serves and replaces `main.zip`. `GET` returns `404` until something is stored, which a run treats as no steps yet. `PUT` returns `204`, and `400` for a body that isn't a zip.

```
GET /v1/zips/branches/{branch}
PUT /v1/zips/branches/{branch}
```

The same, for one branch's zip. Encode the branch name with `encodeURIComponent`.

A zip holds step files at their paths inside `.intent`, like `tests/cart.spec.ts/cart - guest checkout/fill out the checkout.ts`. The last `PUT` wins.

## Storage Setup

### Storage Structure

```
s3://bucket/
├── main.zip
└── branches/
	└── {base64url branch}.zip
```

### Expiry

Branch zips can expire with a lifecycle rule on `branches/`. Lifecycle rules count from an object's last upload, and every `PUT` is a new upload, so a branch that keeps uploading stays. Don't expire `main.zip`: a project whose steps don't change can go a long time without uploading it.

**AWS S3:**

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket intent-steps \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "ExpireBranches",
      "Status": "Enabled",
      "Filter": { "Prefix": "branches/" },
      "Expiration": { "Days": 30 }
    }]
  }'
```

**Cloudflare R2:**

```bash
wrangler r2 bucket lifecycle add intent-steps expire-branches branches/ --expire-days 30
```

With `resolvePath`, put the tenant's folder in the rule's prefix.

### Costs

Steps average about 565 bytes compressed, so 6,000 steps is roughly 3 MB. A run makes one `GET`, plus a `GET` and a `PUT` when it changed a step. R2 charges $0.36 per million reads and $4.50 per million writes, and egress is free.
