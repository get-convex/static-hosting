# Convex Static Hosting

[![npm version](https://badge.fury.io/js/@convex-dev%2Fstatic-hosting.svg)](https://badge.fury.io/js/@convex-dev/static-hosting)

A Convex component that enables hosting static React/Vite apps using Convex
HTTP actions and file storage. No external hosting provider required!

## Quick Start

### Automated Setup (Recommended)

```bash
npm install @convex-dev/static-hosting
npx @convex-dev/static-hosting setup
```

The setup command creates `convex/convex.config.ts` (or shows you what to add)
and registers a `deploy` script. Then:

```bash
npm run deploy
```

### For LLMs / AI Assistants

If you're an LLM helping a user integrate this component, read [INTEGRATION.md](./INTEGRATION.md) for complete integration instructions optimized for AI consumption.

### Manual Setup

See [Manual Setup](#manual-setup-1) section below for step-by-step instructions.

## Features

- 🚀 **Simple deployment** - Upload your built files directly to Convex storage
- 🔒 **Secure by default** - Upload API uses internal functions (not publicly
  accessible)
- 🔄 **SPA support** - Automatic fallback to index.html for client-side routing
- ⚡ **Smart caching** - Hashed assets get long-term caching, HTML is always
  fresh with ETag support
- 🧹 **Auto cleanup** - Old deployment files are automatically garbage collected
- 📦 **Zero config** - Works out of the box with Vite, Create React App, and
  other bundlers



https://github.com/user-attachments/assets/5eaf781f-87da-4292-9f96-38070c86cd39




## Manual Setup

### 1. Install

```bash
npm install @convex-dev/static-hosting
```

### 2. Wire up the component

`convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config.js";

const app = defineApp();
app.use(staticHosting, { httpPrefix: "/" });

export default app;
```

That's it for required wiring. The component owns its own HTTP routes and file
storage — you don't register routes, expose functions, or re-export an upload
API from your app.

> `httpPrefix: "/"` mounts the static site at the deployment root. If your app
> already serves its own HTTP routes there, either change those to a sub-path
> (e.g. `/api/...`) or mount the component at a sub-path instead (e.g.
> `httpPrefix: "/app/"`).

### 3. Add a deploy script

```json
{
  "scripts": {
    "deploy": "npx @convex-dev/static-hosting deploy"
  }
}
```

### Using Non-Vite Bundlers

The CLI's `--build` flag sets `VITE_CONVEX_URL` when running your build command.
For bundlers that use different environment variable conventions, wrap your build
script to pass through the value:

**For Expo:**

```json
{
  "scripts": {
    "build": "EXPO_PUBLIC_CONVEX_URL=${VITE_CONVEX_URL:-$EXPO_PUBLIC_CONVEX_URL} npx expo export --platform web"
  }
}
```

**For Next.js:**

```json
{
  "scripts": {
    "build": "NEXT_PUBLIC_CONVEX_URL=${VITE_CONVEX_URL:-$NEXT_PUBLIC_CONVEX_URL} next build"
  }
}
```

The pattern `${VITE_CONVEX_URL:-$VAR}` uses `VITE_CONVEX_URL` if set (by the CLI),
otherwise falls back to your bundler-specific variable. This allows the CLI's
`--build` flag to work correctly while keeping your standalone `npm run build`
functional.

## Deployment

### One-Shot Deployment (Recommended)

Deploy both Convex backend and static files with a single command:

```bash
# Make sure you're logged in
npx convex login

# Deploy everything
npx @convex-dev/static-hosting deploy
```

The `deploy` command:

1. Builds your frontend with the production `VITE_CONVEX_URL`.
2. Deploys the Convex backend.
3. Uploads `dist/` to the component's storage.

### Manual Two-Step Deployment

```bash
npx convex deploy
npx @convex-dev/static-hosting upload --build --prod


Your app is live at `https://<deployment>.convex.site`.

### CLI options

```bash
npx @convex-dev/static-hosting deploy [options]
  -d, --dist <path>         Path to dist directory (default: ./dist)
  -c, --component <name>    Component instance name (default: staticHosting)
      --skip-build          Skip the build step (use existing dist)
      --skip-convex         Skip Convex backend deployment
      --cdn                 Upload non-HTML assets to convex-fs CDN

npx @convex-dev/static-hosting upload [options]
  -d, --dist <path>         Path to dist directory (default: ./dist)
  -c, --component <name>    Component instance name (default: staticHosting)
      --prod                Deploy to production deployment
  -b, --build               Run 'npm run build' with correct VITE_CONVEX_URL
      --cdn                 Upload non-HTML assets to convex-fs CDN
      --cdn-delete-function App function path that deletes CDN blobs (opt-in)
  -j, --concurrency <n>     Parallel upload workers (default: 5)
```

The CLI runs against the component directly (`npx convex run --component
staticHosting lib:...`) — your app does not need to export `generateUploadUrl`,
`recordAsset`, etc. If you mount the component under a different name, pass
`--component <your-name>`.

## Security

The upload API uses **internal functions** in the Component that can only be called via:

- `npx convex run` (requires Convex CLI authentication)
- Other Convex functions in the Component (server-side only)

This means unauthorized users **cannot** upload files to your site, even if they
know your Convex URL.

## Live Reload on Deploy (optional)

If you want a banner that prompts users to reload when a new deployment ships,
expose the deployment query in your app and drop in `<UpdateBanner />`:

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

`UpdateBanner` resolves `api.staticHosting.getCurrentDeployment` by default. If
you re-export the query under a different module name, pass it explicitly:

```tsx
import { api } from "../convex/_generated/api";
<UpdateBanner getCurrentDeployment={api.myModule.getCurrentDeployment} />
```

For custom UI, use the hook:

```tsx
import { useDeploymentUpdates } from "@convex-dev/static-hosting/react";

const { updateAvailable, reload, dismiss } = useDeploymentUpdates();
```

If `UpdateBanner` is used without exposing the query, a setup warning is logged
to the console and the banner stays hidden.

## Connecting to Convex from the static frontend

When your frontend is served from `*.convex.site`, you can derive the matching
backend URL without an env var:

```ts
import { getConvexUrl } from "@convex-dev/static-hosting";

const convexUrl = import.meta.env.VITE_CONVEX_URL ?? getConvexUrl();
```

## How it works

The static-hosting component owns both the HTTP handler and the file storage:

1. **Build phase** — your bundler produces `dist/`.
2. **Upload phase** — the CLI authenticates with `npx convex run --component`,
   calls the component's internal `generateUploadUrls`, uploads each file to the
   component's storage, records metadata, and garbage-collects old deployments.
3. **Serve phase** — the component's HTTP action looks up assets by path,
   strips its mount prefix from the URL, and streams from storage with smart
   caching. Paths without an extension fall back to `/index.html` for SPAs.

Because everything lives inside the component, your app code stays one line.

## Example

See [`example/`](./example) for a complete Vite + React app integration.

```bash
npm install
npm run dev
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Apache-2.0
