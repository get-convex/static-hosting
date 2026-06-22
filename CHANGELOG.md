# Changelog

## 0.2.0 (Unreleased)

Component-owned HTTP and storage. **Breaking — redeploy your static assets after
upgrading.**

- The component now hosts its own HTTP endpoints and owns the file storage that
  serves them. Wire it up with `app.use(staticHosting, { httpPrefix: "/" })` and
  delete `convex/http.ts` + the upload-API re-exports from
  `convex/staticHosting.ts`.
- Removed `registerStaticRoutes` and `exposeUploadApi` from the client API.
  `exposeDeploymentQuery` and `getConvexUrl` remain if you use the UpdateBanner.
- The component is now named `staticHosting` (previously `selfHosting`). The
  CLI invokes it directly via `npx convex run --component staticHosting
  lib:...`. If you mount the component under a different name, pass
  `--component <your-name>`.
- `useDeploymentUpdates` / `UpdateBanner` use `useQuery_experimental` and
  default to `api.staticHosting.getCurrentDeployment`. If you don't surface
  deployment updates, you no longer need to expose anything.
- Assets uploaded under 0.1.x lived in the app's storage — those references
  won't resolve in 0.2.x. Run `npx @convex-dev/static-hosting deploy` to
  repopulate.
- Recommended setup now prefixes your own HTTP routes with
  `defineApp({ httpPrefix: "/api" })` so the static site can own the root
  without the catch-all route shadowing them.
- SPA fallback is now configurable via a env var. The component declares a
  `STATIC_HOSTING_SPA_FALLBACK` env var (`"enabled"` default / `"disabled"`);
  bind it per-mount via `app.use(staticHosting, { env: { ... } })` to make
  extension-less misses return 404 instead of `index.html`. Because the
  component declares an env var, `app.use` now requires an `env` object (pass
  `env: {}` for defaults). Requires `convex` ≥ 1.39.

## 0.1.3

- Fix missing README in published package

## 0.1.2

- Rename package from `@convex-dev/self-hosting` to `@convex-dev/static-hosting`

## 0.1.1-alpha.0

- Add optional convex-fs CDN mode for static asset serving (`--cdn` flag)
- Non-HTML assets can be served from CDN edge network via convex-fs
- New `cdnBaseUrl` option on `registerStaticRoutes`
- Schema: `storageId` now optional, new `blobId` field for CDN assets
- `gcOldAssets` returns `{ deleted, blobIds }` (breaking change from number return)

## 0.1.2-alpha.1

removed cloudflare for now.

## 0.1.1

- Setup wizard now configures custom domains for Cloudflare Workers
- Added note about running `convex dev` for HTTP actions error
- Added documentation for non-Vite bundlers (Expo, Next.js)

## 0.1.0

- Migrated from Cloudflare Pages to Workers Static Assets

## 0.0.0

- Initial release.
