# Integration Guide: @convex-dev/static-hosting

This guide walks you through hosting a static React/Vite app on Convex using the
`@convex-dev/static-hosting` component. Your frontend ends up at
`https://<deployment>.convex.site`, served alongside your Convex backend with
SPA routing and smart caching.

## What this component gives you

- A drop-in HTTP handler that serves your static files from Convex storage
- One CLI command (`deploy`) that builds, deploys the backend, and uploads files
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

The default setup mounts the component's HTTP handler at the root and moves
app-owned routes under `/api`.

```typescript
import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";

// Serve your own HTTP endpoints (convex/http.ts) under /api so the static
// site can own the root.
const app = defineApp({ httpPrefix: "/api" });
app.use(staticHosting, { httpPrefix: "/" });

export default app;
```

This is the fastest serving mode because the component reads its storage
directly. It is appropriate for new apps and apps whose HTTP routes can live
under `/api`.

If existing webhook, auth, or API routes must stay at the root, use
[App-owned root routing](#app-owned-root-routing). To host the static site under
a sub-path, see [Mounting under a sub-path](#mounting-under-a-sub-path).

> Run `npx convex dev` after editing `convex.config.ts` so codegen picks up the
> component.

### App-owned root routing

Keep the app in control of `convex/http.ts` when changing existing route URLs
would break clients or third-party callbacks.

`convex/convex.config.ts`:

```typescript
import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";

const app = defineApp();
app.use(staticHosting); // no httpPrefix

export default app;
```

`convex/http.ts`:

```typescript
import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { components } from "./_generated/api";

const http = httpRouter();

// Keep existing exact routes at their current URLs.
// auth.addHttpRoutes(http);
registerStaticRoutes(http, components.staticHosting);

export default http;
```

Exact routes win over the static catch-all. Uploads, deployment metadata, SPA
configuration, and file storage remain inside the component, so you can remove
the old `exposeUploadApi` wrappers. This compatibility mode adds an internal
query and storage fetch on uncached requests. Use the component-owned handler
when preserving root-level app routes is not necessary.

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

## Development workflow

Do not use uploaded static files as the main development loop. Run the normal
frontend dev server alongside Convex:

```bash
npx convex dev
npm run dev
```

Vite keeps HMR, source maps, and transient UI state intact. Agent-written code
does not change that tradeoff. HMR may matter less while code is being produced,
but it still matters when a person verifies visuals and debugs interactions.

Use the hosted development deployment as a smoke-test target before release:

```bash
npx @convex-dev/static-hosting upload --build
```

That catches differences in HTTP routing, cache headers, SPA fallback, and base
paths. Production remains the one-command `deploy` flow.

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
<UpdateBanner getCurrentDeployment={api.myModule.getCurrentDeployment} />;
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

## Legacy CDN mode

Do not use `--cdn` for a new integration. It targets an older, unauthenticated
`convex-fs` HTTP API. Current ConvexFS releases require app-owned routes and
upload authentication, which this CLI does not yet provide.

Existing deployments that already expose the legacy routes can keep using the
flag during migration. Everyone else should use the default Convex storage
mode. Supporting current ConvexFS properly needs a separate authenticated
upload and garbage-collection design, not a copy-paste configuration snippet.

## Non-Vite bundlers

The `deploy` build step and `upload --build` set `VITE_CONVEX_URL`. To forward
it to another env var (Expo, Next.js, etc.), wrap your build script:

```json
// Expo
"build": "EXPO_PUBLIC_CONVEX_URL=${VITE_CONVEX_URL:-$EXPO_PUBLIC_CONVEX_URL} npx expo export --platform web"

// Next.js
"build": "NEXT_PUBLIC_CONVEX_URL=${VITE_CONVEX_URL:-$NEXT_PUBLIC_CONVEX_URL} next build"
```

## Security

Upload functions are **internal** to the component. They can only be called via:

- `npx convex run` (requires Convex CLI authentication)
- Other Convex functions (server-side only)

This means unauthorized users cannot upload files, even if they know your Convex
URL.

## CLI Reference

```bash
npx @convex-dev/static-hosting setup
  # Adds the component to convex.config.ts and a deploy script to package.json.

npx @convex-dev/static-hosting deploy [options]
  -d, --dist <path>         Path to dist directory (default: ./dist)
  -c, --component <name>    Component instance name (default: staticHosting)
      --skip-build          Skip the build step
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
      --cdn-delete-function App function path that deletes CDN blobs
  -j, --concurrency <n>     Parallel upload workers (default: 5)
```

## Mounting under a sub-path

To mount under `/app/` (for example, if you have other HTTP routes at the root):

```typescript
app.use(staticHosting, { httpPrefix: "/app/" });
```

The bundler also needs to know the base path so the emitted HTML references the
right URLs. The CLI sets a `STATIC_HOSTING_BASE_PATH` env var matching the
component's mount when it runs your build, so `vite.config.ts` can read it:

```typescript
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.STATIC_HOSTING_BASE_PATH ?? "/",
});
```

Root-mounted apps don't need this — the default is `/`. Webpack/Next.js
equivalents: `publicPath` and `assetPrefix`.

## SPA routing

Requests for an extension-less path that doesn't match an uploaded file fall
back to `index.html`, so client-side routes survive a reload. Paths with an
extension (e.g. `/missing.js`) always 404 when not found. To turn the fallback
off for a multi-page app (unknown paths become real 404s), deploy with
`--no-spa`:

```bash
npx @convex-dev/static-hosting deploy --no-spa
# or: npx @convex-dev/static-hosting upload --no-spa
```

The flag is stored on the deployment record (the `deploymentInfo` table), so the
serving behavior travels with the code you ship rather than living in a separate
env var. Re-deploy without `--no-spa` or with `--spa` to turn it back on.

## Upgrading from 0.1.x

0.2.0 is a **storage-breaking change**. Files uploaded by 0.1.x lived in the
app's storage. Files uploaded by 0.2.x live in the component, so every app must
redeploy its assets once.

1. Upgrade `@convex-dev/static-hosting` and run `npx convex dev` so codegen sees
   the new component API.
2. Remove the `exposeUploadApi` re-exports from `convex/staticHosting.ts`. Keep
   only `exposeDeploymentQuery` if you use `<UpdateBanner />`; otherwise delete
   the file.
3. Choose a serving mode:
   - **Component-owned root:** use the config from
     [Manual Setup](#manual-setup), remove `registerStaticRoutes`, and delete
     `convex/http.ts` if it is empty.
   - **Keep existing root routes:** leave `defineApp()` without an app prefix,
     install the component without `httpPrefix`, and keep the existing
     `registerStaticRoutes(http, components.staticHosting)` call. This preserves
     auth, webhook, and API URLs while using component-owned storage.
4. Run `npx @convex-dev/static-hosting deploy` to deploy the backend and
   repopulate component storage.

The recommended component instance name is `staticHosting`. If you keep an old
name such as `selfHosting`, keep using `components.selfHosting` and pass
`--component selfHosting` to `deploy` and `upload`.

Removed from the client API: `exposeUploadApi`. `registerStaticRoutes`,
`exposeDeploymentQuery`, and `getConvexUrl` remain.

### Side-by-side migration (seamless cutover)

You can run 0.1.x and 0.2.x at the same time and make the final switch a single
mount change with **no re-upload** — so `/` is correct the instant the new mount
goes live and the old version keeps serving until then. The trick is to upload
assets built for the _final_ base path (`/`) ahead of the flip, so the cutover
just exposes assets that are already correct.

The two versions don't collide: 0.1.x is named `selfHosting` and serves via your
app's `convex/http.ts`, while 0.2.x is named `staticHosting` and serves itself.
Both ship from the same package name, so install the old one under an **npm
alias**:

1. Install the new version, and the old one aliased to a distinct slug:

   ```bash
   npm install @convex-dev/static-hosting@^0.2.0
   npm install static-hosting-legacy@npm:@convex-dev/static-hosting@0.1.3
   ```

2. Mount both in `convex/convex.config.ts`, importing the legacy config from the
   alias and staging the new mount at a sub-path:

   ```ts
   import { defineApp } from "convex/server";
   import staticHostingLegacy from "static-hosting-legacy/convex.config.js";
   import staticHosting from "@convex-dev/static-hosting/convex.config.js";

   const app = defineApp();
   app.use(staticHostingLegacy); // 0.1.x — keeps serving the live site at /
   app.use(staticHosting, { httpPrefix: "/next/" }); // 0.2.x — staged here first

   export default app;
   ```

3. Keep your existing `convex/http.ts` registering the **legacy** routes at the
   root, importing `registerStaticRoutes` from the alias:

   ```ts
   import { registerStaticRoutes } from "static-hosting-legacy";
   import { components } from "./_generated/api";

   registerStaticRoutes(http, components.selfHosting);
   ```

4. Build for the **final** base path (`/`, the default) and upload that to the
   new component. For Vite, keep the CLI-managed production `VITE_CONVEX_URL`
   but override Vite's base path for this one build:

   ```bash
   npx @convex-dev/static-hosting upload --build --prod \
     --build-command "npm run build -- --base=/"
   ```

   The CLI still supplies the production backend URL. The explicit Vite
   `--base=/` only overrides `STATIC_HOSTING_BASE_PATH` from the current staged
   mount (`/next/`). If your bundler is not Vite, use its equivalent base-path
   override while preserving the CLI-provided `VITE_CONVEX_URL`.

   Because the assets reference the absolute root (`/assets/…`), the app won't
   be fully clickable at `/next/` — that root is still owned by the old version.
   `/next/` is a smoke test (the component is mounted, serves `index.html`, and
   the files exist at `/next/assets/…`), not a full preview. That's the price of
   a re-upload-free cutover.

5. **Cut over** with a single deploy: delete the legacy `registerStaticRoutes`
   call (and `convex/http.ts` if it's now empty), drop
   `app.use(staticHostingLegacy)`, change the new mount to `httpPrefix: "/"`,
   and `npx convex deploy`. The new component already holds the `/`-based
   assets, so `/` is correct immediately — no rebuild, no re-upload, no
   asset-less window. Once traffic is served by 0.2.x, remove the
   `static-hosting-legacy` dependency.

## Troubleshooting

### 404s on every path

Run `npx convex dev` (or `npx convex deploy`) after adding the component. In
component-owned mode, verify its `httpPrefix`. In app-owned mode, verify that
`registerStaticRoutes` is called from `convex/http.ts` and the component itself
has no `httpPrefix`.

### Wrong `VITE_CONVEX_URL` in the built bundle

```bash
# Right — CLI sets VITE_CONVEX_URL for the target deployment
npx @convex-dev/static-hosting deploy

# Wrong — uses VITE_CONVEX_URL from .env.local
npm run build && npx @convex-dev/static-hosting upload --prod
```

### "Cannot find module convex.config"

Make sure you've installed the package and it's listed in `package.json`:

```bash
npm install @convex-dev/static-hosting
```

### Component name mismatch

If you've renamed the component instance with
`app.use(staticHosting, { name: "custom" })`, pass it to the CLI:

```bash
npx @convex-dev/static-hosting upload --component custom
```

## API Reference

### `registerStaticRoutes(http, component, options?)`

Registers a static catch-all in the app's `convex/http.ts`. Use it when exact
app routes must remain at the same root. `pathPrefix`, `spaFallback`, and
`cdnBaseUrl` are supported. The component must be installed without an
`httpPrefix` so only the app owns that URL space.

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
