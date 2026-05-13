# Integration Guide: @convex-dev/static-hosting

This guide walks you through hosting a static React/Vite app on Convex using
the `@convex-dev/static-hosting` component. Your frontend ends up at
`https://<deployment>.convex.site`, served alongside your Convex backend with
SPA routing and smart caching.

## What this component gives you

- A drop-in HTTP handler that serves your static files from Convex storage
- One CLI command (`deploy`) that builds, deploys the backend, and uploads
  files
- SPA fallback to `index.html` for client-side routing
- Long-term cache headers on hashed assets and ETag-based revalidation on HTML
- Optional live-reload notifications when a new deploy ships
- Authenticated uploads via the Convex CLI (no public upload endpoint)

## Quick Start

```bash
npm install @convex-dev/static-hosting
npx @convex-dev/static-hosting setup
```

The setup script:

- Adds the component to `convex/convex.config.ts`
- Adds a `deploy` script to `package.json`

Then:

```bash
npm run deploy
```

## Manual Setup

### `convex/convex.config.ts`

This is the only required app-side file.

```typescript
import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";

const app = defineApp();
app.use(staticHosting, { httpPrefix: "/" });

export default app;
```

`httpPrefix: "/"` serves the static site at the deployment root. To host under
a sub-path instead (e.g. if you have your own HTTP routes at the root), use
`httpPrefix: "/app/"` and set your bundler's base path to match.

> Run `npx convex dev` after editing `convex.config.ts` so codegen picks up the
> component.

### `package.json`

```json
{
  "scripts": {
    "deploy": "npx @convex-dev/static-hosting deploy"
  }
}
```

## Deployment

```bash
# First time
npx convex login

# Build + backend deploy + upload static files
npx @convex-dev/static-hosting deploy
```

Two-step alternative:

```bash
npx convex deploy
npx @convex-dev/static-hosting upload --build --prod
```

Your app is live at `https://<deployment>.convex.site`.

## Live reload banner (optional)

Show users a banner when a new version is deployed:

### `convex/staticHosting.ts`

```typescript
import { exposeDeploymentQuery } from "@convex-dev/static-hosting";
import { components } from "./_generated/api";

export const { getCurrentDeployment } = exposeDeploymentQuery(
  components.staticHosting,
);
```

### Frontend

```tsx
import { UpdateBanner } from "@convex-dev/static-hosting/react";

function App() {
  return (
    <>
      <UpdateBanner message="New version available!" buttonText="Reload" />
      {/* rest of app */}
    </>
  );
}
```

`UpdateBanner` resolves `api.staticHosting.getCurrentDeployment` by default. To
re-export the query under a different module, pass the reference explicitly:

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

When served from `*.convex.site`, derive the backend URL automatically:

```typescript
import { getConvexUrl } from "@convex-dev/static-hosting";

const convexUrl = import.meta.env.VITE_CONVEX_URL ?? getConvexUrl();
```

## CDN mode (optional)

Non-HTML assets can be served from a CDN edge network via
[convex-fs](https://convexfs.dev) for lower bandwidth use and faster edge
caching. HTML stays in Convex so SPA routing keeps working.

### Setup

```bash
npm install convex-fs
```

`convex/convex.config.ts`:

```typescript
import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import fs from "convex-fs/convex.config";

const app = defineApp();
app.use(staticHosting, { httpPrefix: "/" });
app.use(fs);

export default app;
```

### Deploy with `--cdn`

```bash
npx @convex-dev/static-hosting deploy --cdn
```

### CDN garbage collection (optional)

Old CDN blobs aren't auto-deleted by default. To clean them up, expose a small
delete action in your app and pass its path to the CLI:

`convex/cdn.ts`:

```typescript
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { del } from "convex-fs";
import { components } from "./_generated/api";

export const deleteCdnBlobs = internalAction({
  args: { blobIds: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const blobId of args.blobIds) {
      await del(ctx, components.fs, blobId);
    }
    return null;
  },
});
```

```bash
npx @convex-dev/static-hosting deploy --cdn \
  --cdn-delete-function cdn:deleteCdnBlobs
```

## Non-Vite bundlers

The CLI's `--build` flag sets `VITE_CONVEX_URL` when running your build. To
forward it to another env var (Expo, Next.js, etc.), wrap your build script:

```json
// Expo
"build": "EXPO_PUBLIC_CONVEX_URL=${VITE_CONVEX_URL:-$EXPO_PUBLIC_CONVEX_URL} npx expo export --platform web"

// Next.js
"build": "NEXT_PUBLIC_CONVEX_URL=${VITE_CONVEX_URL:-$NEXT_PUBLIC_CONVEX_URL} next build"
```

## Security

Upload functions are **internal** to the Component.They can only be called via:
- `npx convex run` (requires Convex CLI authentication)
- Other Convex functions (server-side only)

This means unauthorized users cannot upload files, even if they know your Convex URL.

## CLI Reference

```bash
npx @convex-dev/static-hosting setup
  # Adds the component to convex.config.ts and a deploy script to package.json.

npx @convex-dev/static-hosting deploy [options]
  -d, --dist <path>         Path to dist directory (default: ./dist)
  -c, --component <name>    Component instance name (default: staticHosting)
      --skip-build          Skip the build step
      --skip-convex         Skip Convex backend deployment
      --cdn                 Upload non-HTML assets to convex-fs CDN

npx @convex-dev/static-hosting upload [options]
  -d, --dist <path>         Path to dist directory (default: ./dist)
  -c, --component <name>    Component instance name (default: staticHosting)
      --prod                Deploy to production deployment
  -b, --build               Run 'npm run build' with VITE_CONVEX_URL set
      --cdn                 Upload non-HTML assets to convex-fs CDN
      --cdn-delete-function App function path that deletes CDN blobs
  -j, --concurrency <n>     Parallel upload workers (default: 5)
```

## Mounting under a sub-path

To mount under `/app/` (for example, if you have other HTTP routes at the
root):

```typescript
app.use(staticHosting, { httpPrefix: "/app/" });
```

Set your bundler's base path to match — `base: "/app/"` in `vite.config.ts`,
`publicPath: "/app/"` for webpack, `assetPrefix: "/app"` for Next.js — so the
emitted HTML references the right URLs.

## Troubleshooting

### 404s on every path

Run `npx convex dev` (or `npx convex deploy`) after adding the component to
`convex.config.ts` so codegen picks up the new HTTP routes.

### Wrong `VITE_CONVEX_URL` in the built bundle

```bash
# Right — CLI sets VITE_CONVEX_URL for the target deployment
npx @convex-dev/static-hosting deploy

# Wrong — uses VITE_CONVEX_URL from .env.local
npm run build && npx @convex-dev/static-hosting upload --prod
```

### Component name mismatch

If you've renamed the component instance with `app.use(staticHosting, { name:
"custom" })`, pass it to the CLI:

```bash
npx @convex-dev/static-hosting upload --component custom
```

## API Reference

### `exposeDeploymentQuery(component)`

Returns `{ getCurrentDeployment }` — a public query that wraps the component's
deployment singleton. Add this only if you use `<UpdateBanner />` or
`useDeploymentUpdates`.

### `getConvexUrl()`

Browser-only. Returns `https://<deployment>.convex.cloud` when the page is
served from `<deployment>.convex.site`.

## Additional Resources

- [README.md](./README.md)
- [`example/`](./example) — Working example app
- [Component source](./src/component)
