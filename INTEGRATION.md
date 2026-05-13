# Integration Guide: @convex-dev/static-hosting

A Convex component that hosts static React/Vite apps directly on Convex —
serving from the component's own HTTP endpoints and storage. No external
hosting, and minimal app-side wiring.

## Quick Start

```bash
npm install @convex-dev/static-hosting
npx @convex-dev/static-hosting setup
```

The setup script creates `convex/convex.config.ts` and adds a `deploy` script
to `package.json`. Then:

```bash
npm run deploy
```

## Manual Setup

### `convex/convex.config.ts`

This is the only file you need to touch in your app for the basic case.

```typescript
import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";

const app = defineApp();
app.use(staticHosting, { httpPrefix: "/" });

export default app;
```

`httpPrefix: "/"` mounts the component at the deployment root. If your app
needs to serve its own HTTP routes at the root, mount the component at a
sub-path like `httpPrefix: "/app/"` and set your bundler's base path to match
(e.g. `base: "/app/"` in `vite.config.ts`).

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

That's all that's required.

## Deployment

```bash
# Login (first time)
npx convex login

# One-shot: build + deploy backend + upload static files
npx @convex-dev/static-hosting deploy
```

Or two-step:

```bash
npx convex deploy
npx @convex-dev/static-hosting upload --build --prod
```

Your app is live at `https://<deployment>.convex.site`.

The CLI authenticates with `convex run --component staticHosting lib:...` to
talk to the component directly — your app does not need to expose
`generateUploadUrl`, `recordAsset`, or any other upload functions.

## Live reload banner (optional)

If you want to prompt users to reload when a new deployment ships:

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

`UpdateBanner` resolves `api.staticHosting.getCurrentDeployment` by default.
For a different module name, pass the reference explicitly:

```tsx
import { api } from "../convex/_generated/api";
<UpdateBanner getCurrentDeployment={api.myModule.getCurrentDeployment} />
```

If `UpdateBanner` is used without exposing the query, it logs a setup hint to
the console and stays hidden.

For custom UI, use the hook:

```tsx
import { useDeploymentUpdates } from "@convex-dev/static-hosting/react";

const { updateAvailable, reload, dismiss } = useDeploymentUpdates();
```

## CDN mode (optional)

By default, every file is served from the component's HTTP handler reading the
component's storage. Non-HTML assets can be redirected to a CDN edge network
via [convex-fs](https://convexfs.dev) for lower bandwidth and better
edge-cache performance.

The component already issues a 302 redirect to `${origin}/fs/blobs/<blobId>`
when an asset has a `blobId` — those endpoints are served by `convex-fs` at the
deployment root.

### 1. Install convex-fs

```bash
npm install convex-fs
```

### 2. `convex/convex.config.ts`

```typescript
import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import fs from "convex-fs/convex.config";

const app = defineApp();
app.use(staticHosting, { httpPrefix: "/" });
app.use(fs);

export default app;
```

### 3. Deploy with `--cdn`

```bash
npx @convex-dev/static-hosting deploy --cdn
```

### CDN garbage collection (optional)

Old CDN blobs aren't auto-deleted (the component can't reach the
deployment-root `/fs/blobs/<id>` endpoint with auth). Expose a delete function
in your app and pass it to the CLI:

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

Then deploy with:

```bash
npx @convex-dev/static-hosting deploy --cdn \
  --cdn-delete-function cdn:deleteCdnBlobs
```

## Connecting to Convex from the static frontend

When served from `*.convex.site`, derive the matching backend URL:

```typescript
import { getConvexUrl } from "@convex-dev/static-hosting";

const convexUrl = import.meta.env.VITE_CONVEX_URL ?? getConvexUrl();
```

## CLI Reference

```bash
npx @convex-dev/static-hosting setup
  # Creates convex/convex.config.ts and adds a deploy script.

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

## Important Notes

1. **Storage lives in the component.** Uploaded files are stored in the
   component's `_storage` table, not your app's. If you mount multiple
   instances of the component, each has its own storage.
2. Upload functions are **internal** — only reachable via the authenticated
   `npx convex run --component` CLI flow.
3. Hashed assets get `immutable, max-age=31536000`; HTML uses ETag
   revalidation.
4. Paths without a file extension fall back to `/index.html` (SPA mode).
5. Always pass `--build` to the upload CLI so `VITE_CONVEX_URL` matches the
   target deployment.

## Troubleshooting

### 404s on every path

Make sure `convex.config.ts` mounts the component and you've run `npx convex
dev` (or `npx convex deploy`) since adding it. The component's own
`http.ts` is auto-detected during codegen.

### Wrong `VITE_CONVEX_URL` in the built bundle

```bash
# Right — CLI sets VITE_CONVEX_URL for the target deployment
npx @convex-dev/static-hosting deploy

# Wrong — uses VITE_CONVEX_URL from .env.local
npm run build && npx @convex-dev/static-hosting upload --prod
```

### Component name mismatch

If you've renamed the component instance (`app.use(staticHosting, { name:
"custom" })`), pass it to the CLI:

```bash
npx @convex-dev/static-hosting upload --component custom
```

### Mounting under a sub-path

If you set `httpPrefix: "/app/"`, also set `base: "/app/"` in
`vite.config.ts` (or your bundler's equivalent) so emitted assets reference
the right URLs.

## API Reference

### `exposeDeploymentQuery(component)`

Returns `{ getCurrentDeployment }` — a public query that wraps the
component's deployment singleton. Add this to your app only if you use
`<UpdateBanner />` or `useDeploymentUpdates`.

### `getConvexUrl()`

Browser-only. Returns `https://<deployment>.convex.cloud` when the page is
served from `<deployment>.convex.site`.

## Additional Resources

- [README.md](./README.md) — Full documentation
- [`example/`](./example) — Working example app
- [Component source](./src/component)
