# Migration guide: 0.1.x to 0.2.x

This guide covers the breaking upgrade from `@convex-dev/static-hosting` 0.1.x
to 0.2.x (sometimes referred to as v1 to v2).

## Read this before upgrading

0.2.x changes where static files are stored and which HTTP router serves them.
It is not a package-only upgrade.

- **Upgrade Convex to at least 1.37.0.** The optional React helpers import
  `useQuery_experimental`, which older Convex releases do not export.
- **You must upload every static asset again.** 0.1.x put blobs in the app's
  storage. 0.2.x puts them in the component's private storage, and it cannot
  serve the old blobs.
- **Plan cleanup of the old app-storage blobs.** The v2 component cannot delete
  files owned by app storage. Capture the current v1 manifest and audit app
  storage for older v1 orphans before migration. Keep every verified ID through
  the rollback window, then delete only the explicitly approved files.
- **You must choose who owns the root HTTP routes.** The recommended 0.2.x mode
  mounts the component at `/` and moves app-owned HTTP routes under `/api`.
  Compatibility mode keeps existing auth, webhook, and API URLs at the root.
- **Legacy `--cdn` users must keep app-owned root routes.** Both `/fs/upload`
  and `/fs/blobs/*` belong to the app router. Component-owned root mode moves
  that router below `/api` and breaks legacy ConvexFS uploads and asset URLs.
- **Remove `exposeUploadApi`.** The CLI now calls private component functions
  directly; app-level upload wrappers no longer exist.
- **Plan the production cutover.** A normal in-place upgrade can briefly show
  the setup page between the backend deployment and the first 0.2.x upload. If
  that is unacceptable, use the [staged cutover](#staged-cutover) below.
- **Check the built manifest.** 0.2.x accepts at most 1,800 files and 2 MiB of
  serialized manifest metadata per deployment so the atomic switch remains below
  Convex transaction limits. Reduce highly fragmented output or shorten deeply
  nested asset paths before starting the production cutover.
- **Check same-name migration size.** When v2 inherits the v1 component data,
  the old and new manifests must contain no more than 3,800 rows combined. The
  publication rejects atomically without partially replacing the inherited
  manifest when that read budget is exceeded. In the standard in-place path,
  traffic has already switched to v2 and can remain on the setup page. Shrink
  the manifests before the backend cutover or use the staged two-instance path.

## Instructions for coding agents

Read this entire guide before editing the app. Do not treat the dependency
upgrade as the migration.

1. Inventory `convex/http.ts` before choosing a routing mode. Preserve existing
   auth, webhook, and API URLs unless the user explicitly approves moving them.
2. Keep package changes, Convex source changes, codegen, and the asset upload as
   distinct steps so failures are easy to diagnose.
3. Never edit `convex/_generated/*` by hand. Run Convex codegen after the source
   migration.
4. Do not regenerate unrelated secrets or environment variables during an
   in-place migration. They belong to the existing app deployment and should
   survive this component upgrade unchanged.
5. Capture both the current 0.1.x asset manifest and a paginated app-storage
   inventory before replacing the old upload facade. `listAssets` is not a
   complete inventory of historical v1 orphans. Never delete a blob without
   proving it belongs to static hosting and getting user approval, and wait
   until the rollback window closes.
6. Report the routing mode chosen, any URL changes, the asset-less interval,
   current-manifest capture, historical-orphan audit state, and verification
   results back to the user.

## What changed

| Area           | 0.1.x                                      | 0.2.x                                              | Why                                                      |
| -------------- | ------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------- |
| File storage   | App storage                                | Component-private storage                          | The component owns its data and lifecycle                |
| Upload API     | `exposeUploadApi` wrappers in the app      | Private component functions called by the CLI      | Less generated app code and no upload facade to maintain |
| HTTP serving   | `registerStaticRoutes` in `convex/http.ts` | Component-owned HTTP by default                    | Direct storage access and fewer internal round trips     |
| Root routes    | App and static catch-all shared `/`        | Static site owns `/`; app routes default to `/api` | Makes route ownership explicit                           |
| Component name | `selfHosting`                              | `staticHosting`                                    | Matches the package name                                 |
| `--component`  | App module exposing upload wrappers        | Component instance name from `app.use(...)`        | The CLI now invokes the component directly               |
| SPA fallback   | Router option                              | Deployment setting (`--spa` / `--no-spa`)          | Serving behavior travels with the deployed assets        |

`registerStaticRoutes`, `exposeDeploymentQuery`, and `getConvexUrl` remain
available. Only `exposeUploadApi` was removed from the client API.

## Before you start

1. Confirm the app uses `convex` 1.37.0 or newer.
2. Stop any running `convex dev` watcher. A watcher can observe the temporary
   state where the package is new but app files still import removed 0.1.x APIs,
   producing noisy resolution and `exposeUploadApi` errors. Restart it only
   after the package and source edits are complete.
3. Note every route currently registered by `convex/http.ts`, especially auth
   callbacks and third-party webhooks. Decide whether their URLs may move under
   `/api`.
4. Check whether the component has a custom instance name. In 0.1.x the
   generated reference was normally `components.selfHosting`; in 0.2.x the
   default is `components.staticHosting`.
5. Check whether uploads use the legacy `--cdn` flag. If they do, preserve the
   root `/fs/upload` and `/fs/blobs/*` routes and choose Option B below.
6. Make sure the current production deployment and static upload are healthy so
   you have a known rollback point.
7. While the 0.1.x facade is still deployed, capture its current asset list and
   a paginated app-storage inventory as described in
   [Clean up 0.1.x app-storage blobs](#clean-up-01x-app-storage-blobs). Store
   the output outside the repository.

## Standard migration

### 1. Upgrade the package

```bash
npm install convex@^1.37.0 @convex-dev/static-hosting@^0.2.0
```

Do not run the production deploy yet. Update the Convex files first.

The `^0.2.0` range intentionally selects a stable 0.2.x release. It does not
select `0.2.0-alpha.*`. When testing before the stable publish, install the
exact prerelease tag or preview URL supplied by the release author.

When testing a URL-based preview with Bun, replacing the installed release can
occasionally report `DependencyLoop`. Remove the old dependency first, then add
the preview URL. This was only observed with the prerelease URL workflow, not a
published 0.2.x package.

### 2. Choose a routing mode

#### Option A: component-owned root (recommended)

Use this when app-owned HTTP endpoints can move from `/route` to `/api/route`,
or when the app has no other HTTP endpoints. The component serves files from its
storage directly, so this is the fastest mode.

Do not use this option with the legacy `--cdn` flag. Its `/fs/upload` and
`/fs/blobs/*` routes must remain on the app-owned root router. Choose Option B
until the deployment no longer uses ConvexFS.

Replace the old component registration with:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config.js";

// Routes from convex/http.ts are now served below /api.
const app = defineApp({ httpPrefix: "/api" });
app.use(staticHosting, { httpPrefix: "/" });

export default app;
```

Remove `registerStaticRoutes(...)` from `convex/http.ts`. Delete the file if the
static catch-all was its only route. If the file contains other routes, keep it;
those routes will now be served under `/api`.

Do not use this option without updating external callback URLs and clients that
still call the old root paths.

#### Option B: keep existing HTTP routes at the root

Use compatibility mode when auth callbacks, webhooks, or public APIs cannot
change URL. The component still owns storage and uploads, but the app's HTTP
action serves the files after an internal component lookup.

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config.js";

const app = defineApp();
app.use(staticHosting); // no httpPrefix: the app owns HTTP routing

export default app;
```

Update the existing router to reference the new component:

```ts
// convex/http.ts
import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { components } from "./_generated/api";

const http = httpRouter();

// Keep existing exact routes and helper registrations here.
// auth.addHttpRoutes(http);
registerStaticRoutes(http, components.staticHosting);

export default http;
```

Exact app routes take precedence over the static catch-all. This mode preserves
their URLs, but an uncached static request adds an internal query and storage
fetch compared with component-owned serving.

### 3. Remove the old upload facade

A typical 0.1.x `convex/staticHosting.ts` looked like this:

```ts
import {
  exposeDeploymentQuery,
  exposeUploadApi,
} from "@convex-dev/static-hosting";
import { components } from "./_generated/api";

export const {
  generateUploadUrl,
  generateUploadUrls,
  recordAsset,
  recordAssets,
  gcOldAssets,
  listAssets,
} = exposeUploadApi(components.selfHosting);

export const { getCurrentDeployment } = exposeDeploymentQuery(
  components.selfHosting,
);
```

Delete all `exposeUploadApi` imports and exports. If the app uses
`<UpdateBanner />` or `useDeploymentUpdates`, keep only the deployment query and
point it at the new component:

```ts
// convex/staticHosting.ts
import { exposeDeploymentQuery } from "@convex-dev/static-hosting";
import { components } from "./_generated/api";

export const { getCurrentDeployment } = exposeDeploymentQuery(
  components.staticHosting,
);
```

If the app does not use deployment notifications, delete
`convex/staticHosting.ts` entirely **unless it also contains the app action used
by legacy `--cdn` cleanup**. Legacy CDN users must keep that action, remove only
the old upload facade, and continue passing its function path with
`--cdn-delete-function`. Otherwise the old blob IDs leave the live manifest
without being deleted.

Existing explicit `getCurrentDeployment` props still work. In 0.2.x the React
helpers also default to `api.staticHosting.getCurrentDeployment` when the query
is exported from the file above.

### 4. Check scripts and component names

The recommended production script is:

```json
{
  "scripts": {
    "deploy": "npx @convex-dev/static-hosting deploy"
  }
}
```

An existing legacy CDN deployment must preserve both flags and its app-level
delete action. For example, if that action is exported as
`staticHosting:deleteCdnBlobs`:

```json
{
  "scripts": {
    "deploy": "npx @convex-dev/static-hosting deploy --cdn --cdn-delete-function staticHosting:deleteCdnBlobs"
  }
}
```

In 0.2.x, `--component` names the component instance from `app.use(...)`; it no
longer names the app module that exposed `exposeUploadApi`.

The default is `staticHosting`. If you deliberately keep another instance name,
use it consistently:

```ts
app.use(staticHosting, { name: "selfHosting", httpPrefix: "/" });
```

```bash
npx @convex-dev/static-hosting deploy --component selfHosting
```

The same rule applies to `upload`. Generated references also follow the custom
name, for example `components.selfHosting`. Keeping `selfHosting` can preserve
the old component rows during the backend switch. Those rows still point at app
storage, so 0.2.x treats them as unavailable and serves the HTTP 503 setup page
until the first v2 upload atomically replaces the manifest. The upload cleanup
skips those foreign IDs; it does not delete the v1 app-storage blobs.

The commands below show the default v2 instance name, `staticHosting`. Replace
it with the exact chosen v2 name, such as `selfHosting` or `staticHostingV2`, in
every `--component` flag and generated `components.*` reference.

### 5. Regenerate and test on a development deployment

Push the new component definition and regenerate `components.*` references:

```bash
npx convex dev --once
```

Do not hand-edit `convex/_generated/api.d.ts` to change `selfHosting` to
`staticHosting`. Codegen makes that change from `convex/convex.config.ts` and
keeps the rest of the generated API consistent.

Then build and repopulate the new component storage:

```bash
npx @convex-dev/static-hosting upload --build --component staticHosting
```

Between these two commands, a root request may show the static-hosting setup
page. That is expected: the 0.2.x component is mounted, but its private storage
is still empty. The page returns HTTP 503 with `Retry-After` so monitoring sees
the deployment as unavailable. The successful upload should replace it with the
app. On a local deployment, `convex dev --once` may stop the local listener when
it exits. Start `npx convex dev` before curling the site if you need to observe
this intermediate response.

After upload, you can inspect the new component-private manifest directly:

```bash
npx convex run --component staticHosting lib:listAssets '{"limit":4096}'
```

These are v2 component-storage IDs. Do not add them to the v1 app-storage
cleanup list.

Test all of the following on the development `*.convex.site` URL:

- `/` serves the current app.
- A client-side route still works after a full browser refresh.
- A missing asset with an extension, such as `/missing.js`, returns 404.
- Existing auth, webhook, and API routes are at the URLs expected for the
  routing mode you chose.
- Existing backend data and an authentication session created before the
  migration still work afterward.
- If the app uses Convex Auth at the root, both
  `/.well-known/openid-configuration` and `/.well-known/jwks.json` still return
  JSON successfully.
- Hashed assets have long-lived immutable caching, while HTML revalidates.
- If used, the update banner detects a later upload.

### 6. Deploy production

After the development smoke test passes:

```bash
npx @convex-dev/static-hosting deploy --component staticHosting
```

If this standard migration removes or renames the old `selfHosting` component,
Convex may ask for confirmation before deleting its component records. Do not
approve that prompt blindly. Confirming deletion removes the v1 manifest, so a
rollback must reconstruct it from the captured app-storage inventory or run a
full v1 upload. If you require a backend-only rollback, stop here and use the
[staged cutover](#staged-cutover), which keeps the legacy component mounted
through the rollback window. Rehearse and explicitly handle this confirmation in
CI.

This builds with the production Convex URL, deploys the backend, and uploads the
files into the 0.2.x component storage. Do not use a separately built `dist/`
unless you deliberately pass `--skip-build`; the CLI also supplies the correct
base path and `VITE_CONVEX_URL` during its build.

The ordinary command deploys the new backend before the first 0.2.x asset
upload. We observed the setup page during that interval in a real 0.1.4 to 0.2
migration. Use the [staged cutover](#staged-cutover) when even a short frontend
interruption is unacceptable.

## Clean up 0.1.x app-storage blobs

Unmounting the old component or replacing its asset records does not delete the
underlying v1 blobs because those files belong to the app's storage. If you do
nothing, the old files remain stored after migration.

There are two sets to account for:

1. **Current v1 assets.** The v1 `listAssets` facade identifies these directly.
2. **Historical v1 orphans.** Older v1 uploads may already have left replaced
   same-path files in app storage. They no longer appear in `listAssets`.

This distinction matters in practice. In a fresh 0.1.4 rehearsal, two uploads
left seven static-hosting blobs in app storage while `listAssets` reported only
the four current files. The older CSS, SVG, and HTML blobs were invisible to the
manifest. Treat the manifest as the rollback set and a lower bound for cleanup,
not as a complete app-storage inventory.

Legacy ConvexFS CDN blobs need a separate cleanup path. The v2 private cleanup
queue automatically inherits v1 CDN IDs only when v2 reuses the same component
instance name and data. If v1 and v2 use different names, including the staged
two-instance cutover, invoke the retained app delete action explicitly with the
captured v1 `blobId` values after the rollback window closes. For example:

```bash
npx convex run staticHosting:deleteCdnBlobs \
  '{"blobIds":["<captured-v1-blob-id>"]}' --prod
```

Review the exact list and get deletion approval first. Historical ConvexFS
orphans absent from the v1 manifest cannot be inferred by v2. Inventory them
through the legacy storage integration before claiming CDN cleanup is complete.

### Capture the current v1 manifest

While the 0.1.x `listAssets` facade is still deployed, save its production
output somewhere protected and outside the repository:

```bash
npx convex run staticHosting:listAssets '{"limit":4096}' --prod \
  > ~/static-hosting-v1-assets.json
```

If the old facade is exported from another module, replace `staticHosting` with
that module path. Check the output contains the expected static paths and
`storageId` values. If it reaches 4096 entries, stop and arrange a paginated
export before migrating rather than accepting a truncated cleanup manifest.

### Audit app storage for older v1 orphans

The Convex dashboard can export the app's `_storage` metadata. An agent can also
add this temporary paginated internal query before migration:

```ts
// convex/auditStaticHostingStorage.ts
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

const storageMetadata = v.object({
  _id: v.id("_storage"),
  _creationTime: v.number(),
  contentType: v.optional(v.string()),
  sha256: v.string(),
  size: v.number(),
});

export const listAppStorage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(storageMetadata),
  handler: async (ctx, { paginationOpts }) => {
    return await ctx.db.system
      .query("_storage")
      .order("asc")
      .paginate(paginationOpts);
  },
});
```

Deploy it while v1 is still live, then save every page outside the repository:

```bash
npx convex run auditStaticHostingStorage:listAppStorage \
  '{"paginationOpts":{"numItems":100,"cursor":null}}' --prod \
  > ~/static-hosting-v1-storage-page-001.json
```

Repeat with each returned `continueCursor` until `isDone` is true. Remove the
temporary query after the inventory is safely stored.

The `_storage` table can also contain uploads owned by the rest of the app. The
IDs from the current v1 manifest are definitely static-hosting files. Classify
additional historical candidates using deployment timing, content type, size,
hash matches to known static assets, and, when necessary, the blob contents. In
the rehearsal, duplicate hashes and adjacent creation times tied the older CSS
and SVG files to the first v1 upload. Never treat every `_storage` row as a
static-hosting blob, and never bulk-delete the table.

Build an explicitly reviewed cleanup list from the current manifest plus only
the historical candidates you have verified.

Complete the migration and keep the manifest, inventory, and approved cleanup
list unchanged through the rollback window. Deleting current v1 blobs earlier
makes a 0.1.x rollback require another full asset upload.

After the rollback window closes, delete only the approved `storageId` values
from app storage. One safe option is a temporary internal mutation:

```ts
// convex/cleanupStaticHosting.ts
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const deleteLegacyStaticHostingBlobs = internalMutation({
  args: { storageIds: v.array(v.id("_storage")) },
  returns: v.object({ deleted: v.number(), alreadyMissing: v.number() }),
  handler: async (ctx, { storageIds }) => {
    let deleted = 0;
    let alreadyMissing = 0;

    for (const storageId of storageIds) {
      const metadata = await ctx.db.system.get("_storage", storageId);
      if (metadata === null) {
        alreadyMissing++;
        continue;
      }

      await ctx.storage.delete(storageId);
      deleted++;
    }

    return { deleted, alreadyMissing };
  },
});
```

Deploy that mutation, then pass only the captured IDs in manageable batches:

```bash
npx convex run cleanupStaticHosting:deleteLegacyStaticHostingBlobs \
  '{"storageIds":["<captured storageId>", "<captured storageId>"]}' --prod
```

Verify the returned counts, then remove the temporary mutation. Keep or dispose
of the saved audit evidence according to the app's retention policy. Do not
delete unrelated app-storage files. Agents must show the user the exact approved
ID list and get explicit approval before running this cleanup.

## Sub-path deployments

Mount the component at the final prefix:

```ts
app.use(staticHosting, { httpPrefix: "/app/" });
```

The CLI exposes that mount as `STATIC_HOSTING_BASE_PATH`. Configure the bundler
so generated asset URLs include it. For Vite:

```ts
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.STATIC_HOSTING_BASE_PATH ?? "/",
});
```

Then verify `/app/`, an asset below `/app/assets/`, and a refreshed SPA route
below `/app/`. Root-mounted apps do not need a bundler base-path change.

## Staged cutover

Use this path when production must keep serving 0.1.x until 0.2.x storage is
fully populated. Both component versions run side by side, and the final route
switch requires no upload.

### 1. Install 0.2.x and alias the last 0.1.x release

```bash
npm install convex@^1.37.0 @convex-dev/static-hosting@^0.2.0 \
  static-hosting-legacy@npm:@convex-dev/static-hosting@0.1.4
```

### 2. Mount both components

Keep 0.1.x serving through the app router and stage the 0.2.x HTTP handler at a
temporary prefix:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config.js";
import staticHostingLegacy from "static-hosting-legacy/convex.config.js";

const app = defineApp();
app.use(staticHostingLegacy, { name: "selfHosting" });
app.use(staticHosting, { httpPrefix: "/__static_v2/" });

export default app;
```

`selfHosting` above must be the exact v1 instance name captured before the
migration. If the app used a custom name, pass that custom name to `app.use` and
replace every `components.selfHosting` reference in the following examples with
the matching generated property. Do not mount a fresh default legacy component,
because that leaves the real v1 manifest behind and breaks the promised
backend-only rollback.

If the v1 instance was already named `staticHosting`, give v2 a different name
for the whole migration. Two mounted components cannot share an instance name,
and renaming v2 at cutover would create a fresh component with empty storage:

```ts
app.use(staticHostingLegacy, { name: "staticHosting" });
app.use(staticHosting, {
  name: "staticHostingV2",
  httpPrefix: "/__static_v2/",
});
```

In that case use `components.staticHostingV2` for v2 integrations and pass
`--component staticHostingV2` to every v2 upload or deploy command. Keep that v2
name through cutover and rollback.

Keep the 0.1.x root catch-all and upload facade importing from the alias until
cutover:

```ts
// convex/http.ts
import { registerStaticRoutes } from "static-hosting-legacy";
import { components } from "./_generated/api";

// Register existing exact routes first.
registerStaticRoutes(http, components.selfHosting);
```

```ts
// convex/staticHosting.ts: only while 0.1.x is live
import { exposeDeploymentQuery, exposeUploadApi } from "static-hosting-legacy";
import { components } from "./_generated/api";

export const {
  generateUploadUrl,
  generateUploadUrls,
  recordAsset,
  recordAssets,
  gcOldAssets,
  listAssets,
} = exposeUploadApi(components.selfHosting);

export const { getCurrentDeployment } = exposeDeploymentQuery(
  components.selfHosting,
);
```

Deploy this backend. The live root still uses 0.1.x:

```bash
npx convex deploy
```

### 3. Preload 0.2.x storage for its final URL

Build assets for the **final** base path, not the temporary staging prefix. For
a Vite app that will ultimately live at `/`:

```bash
npx @convex-dev/static-hosting upload --build --prod \
  --build-command "npm run build -- --base=/"
```

Add `--component staticHostingV2` here when using the collision-safe v2 name
described above.

The CLI still supplies the production `VITE_CONVEX_URL`. The explicit Vite base
overrides the temporary `/__static_v2/` mount for this build.

The staging prefix is useful for confirming that the new component is mounted
and has `index.html`. Because the uploaded HTML points to root asset URLs that
0.1.x still owns, it is not a complete visual preview. Use a separate
development deployment for the full smoke test.

### 4. Switch routes in one backend deploy

Choose the same final routing mode described in the standard migration:

- **Component-owned root:** keep the legacy component mounted without its static
  catch-all, change to `defineApp({ httpPrefix: "/api" })`, and mount 0.2.x with
  `{ httpPrefix: "/" }`. The old component remains data-only during the rollback
  window.
- **Keep existing root routes:** keep both components mounted with no
  `httpPrefix`, and change `registerStaticRoutes` to import from
  `@convex-dev/static-hosting` and use `components.staticHosting`. The legacy
  component again remains mounted only to preserve its rollback data.

For a v1 instance named `staticHosting`, keep using `components.staticHostingV2`
in the second option. Do not rename the populated v2 instance during cutover.

Also remove the legacy `exposeUploadApi` exports. Keep an
`exposeDeploymentQuery` export only if the app uses deployment notifications,
and point it at the selected v2 instance: `components.staticHosting`, or
`components.staticHostingV2` in the collision-safe case.

Then switch traffic without rebuilding or uploading:

```bash
npx convex deploy
```

The 0.2.x component already contains the final-path assets, so the new route
owner can serve them immediately. Keep the legacy package alias, its component
mount, and the captured 0.1.x app-storage IDs until the rollback window closes.
That keeps rollback to a backend-only route change.

After the rollback window closes, remove the legacy `app.use(...)`, deploy the
backend, and review any Convex prompt confirming deletion of the legacy
component data. Then uninstall the alias:

```bash
npm uninstall static-hosting-legacy
```

For CI-driven deploys, rehearse the component-removal step on a development
deployment and make the confirmation behavior explicit in the release job.
Finally follow
[Clean up 0.1.x app-storage blobs](#clean-up-01x-app-storage-blobs).

## Troubleshooting

### `components.staticHosting` does not exist

Run `npx convex dev --once` after changing `convex/convex.config.ts`. If a
custom component name is configured, use that generated property instead. Do not
patch the generated API file manually.

### The watcher reports missing `exposeUploadApi` or `convex.config`

The watcher observed a half-migrated source tree. Stop it, finish the dependency
and source edits, confirm that `exposeUploadApi` and `components.selfHosting`
are gone, then run `npx convex dev --once`.

### The CLI cannot reach the component

Deploy the backend first and make sure `--component` matches the instance name
passed to `app.use(...)`:

```bash
npx convex deploy
npx @convex-dev/static-hosting upload --build --prod \
  --component staticHosting
```

### The setup page appears after upgrading

The 0.2.x HTTP handler is deployed but its private storage is empty. Run the
0.2.x upload or deploy command. Files uploaded by 0.1.x cannot fill this
storage. The setup response is deliberately HTTP 503 until an upload succeeds.

### Existing callbacks return 404

If component-owned root routing was selected, app HTTP routes moved below
`/api`. Update the callers or switch to app-owned root compatibility mode.

### Assets 404 below a sub-path

Configure the bundler base path and rebuild through the CLI. For Vite, use
`STATIC_HOSTING_BASE_PATH` as shown in
[Sub-path deployments](#sub-path-deployments).

## Rollback

For a standard in-place migration, reinstall 0.1.4, restore the old component
registration, `registerStaticRoutes`, and `exposeUploadApi` wrappers, then
redeploy the 0.1.x backend and assets. Do not expect 0.1.x to serve files from
0.2.x component storage. Keeping the captured 0.1.x blobs preserves the option
to re-record those files during recovery; it does not restore the old component
records by itself. If the blobs have already been cleaned up, a full 0.1.x
upload is required.

For a staged cutover, leave the aliased 0.1.4 component in place until the
rollback window closes. In app-owned compatibility mode, change
`registerStaticRoutes` back to the alias and `components.selfHosting`.

In component-owned root mode, also restore `defineApp()` without the `/api`
prefix and move v2 away from the root before restoring the legacy catch-all:

```ts
const app = defineApp();
app.use(staticHostingLegacy, { name: "selfHosting" });
app.use(staticHosting, { httpPrefix: "/__static_v2/" });
```

Use the captured custom v1 name here too when it was not `selfHosting`. If the
v1 name is `staticHosting`, use `staticHostingV2` as the v2 component name here,
matching the collision-safe mount used during preload.

That restores the pre-cutover route ownership while retaining both component
mounts. The rollback is backend-only because the v1 component and its manifest
never went away. Do not confirm deletion of the legacy component data before the
rollback window closes.

Do not run the legacy app-storage cleanup until the rollback window has closed
and the user has approved making the v1 asset set unrecoverable without another
upload.
