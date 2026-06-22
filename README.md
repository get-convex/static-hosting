# Convex Static Hosting

[![npm version](https://badge.fury.io/js/@convex-dev%2Fstatic-hosting.svg)](https://badge.fury.io/js/@convex-dev/static-hosting)

A Convex component for hosting static React/Vite apps directly on Convex — no
separate hosting provider, no DNS to wire up, no second deploy target. Run one
command and your frontend is live at `https://<deployment>.convex.site`
alongside your backend.

## Features

- 🚀 **One-command deploy** — build, push backend, and upload static files in a
  single step.
- 🔄 **SPA routing** — paths without an extension fall back to `index.html`.
- ⚡ **Smart caching** — hashed assets get long-term immutable caching; HTML
  uses ETag revalidation so updates land instantly.
- 🔔 **Live reload notifications** — connected clients can subscribe to a query
  that fires when a new version ships, with a drop-in `<UpdateBanner />`.
- 🔒 **Authenticated uploads** — uploads go through the Convex CLI's
  authenticated session; there's no public upload endpoint.
- 🧹 **Automatic cleanup** — files from previous deployments are garbage
  collected on every deploy.

https://github.com/user-attachments/assets/5eaf781f-87da-4292-9f96-38070c86cd39

## Quick Start

```bash
npm install @convex-dev/static-hosting
npx @convex-dev/static-hosting setup
```

The setup command adds the component to `convex/convex.config.ts` and creates a
`deploy` script in `package.json`. Then:

```bash
npm run deploy
```

Your app is live at `https://<deployment>.convex.site`.

## Setup

### 1. Install

```bash
npm install @convex-dev/static-hosting
```

### 2. Register the component

`convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config.js";

// Your own HTTP endpoints (convex/http.ts) are served under /api so the
// static site can own the root.
const app = defineApp({ httpPrefix: "/api" });
app.use(staticHosting, { httpPrefix: "/" });

export default app;
```

The static site is mounted at `/` with a catch-all route, so it would shadow
any HTTP routes you define at the root. Passing `httpPrefix: "/api"` to
`defineApp` moves your own `convex/http.ts` routes under `/api/...`, leaving the
root for the static site (your frontend then calls those endpoints at
`/api/...`).

To instead host the static site itself under a sub-path, see
[Mounting under a sub-path](#mounting-under-a-sub-path) below.

### 3. Add a deploy script

```json
{
  "scripts": {
    "deploy": "npx @convex-dev/static-hosting deploy"
  }
}
```

That's it.

## Deployment

```bash
npx convex login            # first time only
npx @convex-dev/static-hosting deploy
```

The `deploy` command:

1. Builds your frontend with the production `VITE_CONVEX_URL`.
2. Deploys the Convex backend.
3. Uploads `dist/` to Convex.

For more control, you can run the two halves separately:

```bash
npx convex deploy
npx @convex-dev/static-hosting upload --build --prod
```

Your app is live at `https://<deployment>.convex.site`.

### Non-Vite bundlers

The `--build` flag sets `VITE_CONVEX_URL` for your build. To use a different
env var (Expo, Next.js, etc.), wrap your build script so the value passes
through:

```json
// Expo
"build": "EXPO_PUBLIC_CONVEX_URL=${VITE_CONVEX_URL:-$EXPO_PUBLIC_CONVEX_URL} npx expo export --platform web"

// Next.js
"build": "NEXT_PUBLIC_CONVEX_URL=${VITE_CONVEX_URL:-$NEXT_PUBLIC_CONVEX_URL} next build"
```

### CLI options

```bash
npx @convex-dev/static-hosting deploy [options]
  -d, --dist <path>         Path to dist directory (default: ./dist)
  -c, --component <name>    Component instance name (default: staticHosting)
      --skip-build          Skip the build step (use existing dist)
      --skip-convex         Skip Convex backend deployment
      --no-spa              Disable SPA fallback (404 instead of /index.html)
      --cdn                 Upload non-HTML assets to convex-fs CDN

npx @convex-dev/static-hosting upload [options]
  -d, --dist <path>         Path to dist directory (default: ./dist)
  -c, --component <name>    Component instance name (default: staticHosting)
      --prod                Deploy to production deployment
  -b, --build               Run 'npm run build' with VITE_CONVEX_URL set
      --no-spa              Disable SPA fallback (404 instead of /index.html)
      --cdn                 Upload non-HTML assets to convex-fs CDN
      --cdn-delete-function App function path that deletes CDN blobs (opt-in)
  -j, --concurrency <n>     Parallel upload workers (default: 5)
```

If you mount the component under a different name with `app.use(staticHosting,
{ name: "..." })`, pass it with `--component`.

## Live reload on deploy

Show users a banner when a new version is available:

`convex/staticHosting.ts`:

```ts
import { exposeDeploymentQuery } from "@convex-dev/static-hosting";
import { components } from "./_generated/api";

export const { getCurrentDeployment } = exposeDeploymentQuery(
  components.staticHosting,
);
```

`src/App.tsx`:

```tsx
import { UpdateBanner } from "@convex-dev/static-hosting/react";

function App() {
  return (
    <>
      <UpdateBanner message="New version!" buttonText="Reload" />
      {/* ... */}
    </>
  );
}
```

`UpdateBanner` resolves `api.staticHosting.getCurrentDeployment` automatically.
If you re-export the query under a different module name, pass it explicitly:

```tsx
import { api } from "../convex/_generated/api";
<UpdateBanner getCurrentDeployment={api.myModule.getCurrentDeployment} />
```

For custom UI, use the hook:

```tsx
import { useDeploymentUpdates } from "@convex-dev/static-hosting/react";

const { updateAvailable, reload, dismiss } = useDeploymentUpdates();
```

## Connecting to Convex from the frontend

When your frontend is served from `*.convex.site`, you can derive the backend
URL without an env var:

```ts
import { getConvexUrl } from "@convex-dev/static-hosting";

const convexUrl = import.meta.env.VITE_CONVEX_URL ?? getConvexUrl();
```

## Mounting under a sub-path

Mount the static site under a sub-path if you have other routes at the root:

```ts
app.use(staticHosting, { httpPrefix: "/app/" });
```

You'll also need to tell your bundler about the base path so the emitted HTML
references the right URLs. The CLI sets a `STATIC_HOSTING_BASE_PATH` env var
matching the component's mount when it runs your build, so `vite.config.ts`
can read it directly:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.STATIC_HOSTING_BASE_PATH ?? "/",
});
```

Root-mounted apps don't need this — the default is `/`. For webpack use
`publicPath`, for Next.js `assetPrefix`.

## SPA routing

By default, requests for a path with no file extension that doesn't match an
uploaded file fall back to `index.html`, so client-side routes like
`/dashboard/settings` work on reload. For a multi-page app where unknown paths
should be a real 404, deploy with `--no-spa`:

```bash
npx @convex-dev/static-hosting deploy --no-spa
```

The setting is stored with the deployment, so it travels with the code you
ship rather than living in a separate env var. Requests for paths with an
extension (e.g. `/missing.js`) always 404 when not found, regardless of this
setting.

## Upgrading from 0.1.x

0.2.0 moved HTTP serving and file storage into the component itself, which is a
**breaking change** — delete `convex/http.ts` and the upload-API re-exports,
re-register the component as shown above, and **redeploy your assets** (assets
uploaded under 0.1.x lived in your app's storage and won't resolve). See the
[CHANGELOG](./CHANGELOG.md) and the [upgrade guide in
INTEGRATION.md](./INTEGRATION.md#upgrading-from-01x) for the full steps,
including a side-by-side migration that avoids downtime.

## How it works

1. **Build** — your bundler emits `dist/`.
2. **Upload** — the CLI uses your authenticated Convex session to generate
   signed upload URLs, push files to Convex storage, record metadata, and GC
   old deployments.
3. **Serve** — an HTTP action looks up the requested path, streams the file
   with the right `Content-Type`, applies long-term caching for hashed assets,
   and falls back to `index.html` for SPA routes.

## Example

See [`example/`](./example) for a complete Vite + React app.

```bash
npm install
npm run dev
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Apache-2.0
