import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
import { hasFileExtension } from "./serving.js";

const staticAssetValidator = v.object({
  _id: v.id("staticAssets"),
  _creationTime: v.number(),
  path: v.string(),
  storageId: v.optional(v.id("_storage")),
  blobId: v.optional(v.string()),
  contentType: v.string(),
  deploymentId: v.string(),
});

const deploymentInfoValidator = v.object({
  _id: v.id("deploymentInfo"),
  _creationTime: v.number(),
  currentDeploymentId: v.string(),
  deployedAt: v.number(),
  spaFallback: v.optional(v.boolean()),
});

const httpAssetValidator = v.object({
  storageUrl: v.optional(v.string()),
  blobId: v.optional(v.string()),
  contentType: v.string(),
  etag: v.optional(v.string()),
});

async function resolveAssetDocument(
  ctx: QueryCtx,
  path: string,
  spaFallbackOverride?: boolean,
) {
  const exact = await ctx.db
    .query("staticAssets")
    .withIndex("by_path", (q) => q.eq("path", path))
    .unique();
  if (exact) return exact;

  if (hasFileExtension(path)) return null;

  const info = await ctx.db.query("deploymentInfo").first();
  const spaFallback = spaFallbackOverride ?? info?.spaFallback ?? true;
  if (!spaFallback) return null;

  return await ctx.db
    .query("staticAssets")
    .withIndex("by_path", (q) => q.eq("path", "/index.html"))
    .unique();
}

async function deleteStorageFile(ctx: MutationCtx, storageId: Id<"_storage">) {
  // A v2 component mounted with the old `selfHosting` name can inherit v1 rows
  // containing app-owned storage IDs. They are deliberately invisible in the
  // component namespace. Checking metadata avoids relying on backend error text
  // and treats both those foreign IDs and already-deleted files as absent.
  const metadata = await ctx.db.system.get("_storage", storageId);
  if (metadata === null) return false;

  await ctx.storage.delete(storageId);
  return true;
}

export const getCurrentDeployment = query({
  args: {},
  returns: v.union(deploymentInfoValidator, v.null()),
  handler: async (ctx) => {
    return await ctx.db.query("deploymentInfo").first();
  },
});

// Narrow serving API used by the app-owned `registerStaticRoutes` compatibility
// mode. The app can resolve a public asset, but all storage and deployment
// management stays encapsulated in the component.
export const resolveAssetForHttp = query({
  args: {
    path: v.string(),
    spaFallback: v.optional(v.boolean()),
  },
  returns: v.union(httpAssetValidator, v.null()),
  handler: async (ctx, { path, spaFallback }) => {
    const asset = await resolveAssetDocument(ctx, path, spaFallback);
    if (!asset) return null;

    const storageUrl = asset.storageId
      ? await ctx.storage.getUrl(asset.storageId)
      : null;

    // During a same-name v1 to v2 migration, inherited v1 rows point at app
    // storage and cannot be fetched by the component. Return no asset so the
    // compatibility HTTP handler shows its normal setup response for `/` until
    // the first v2 upload replaces the manifest.
    if (asset.storageId && !storageUrl && !asset.blobId) return null;

    return {
      ...(storageUrl ? { storageUrl } : {}),
      ...(asset.blobId ? { blobId: asset.blobId } : {}),
      contentType: asset.contentType,
      ...(asset.storageId ? { etag: `"${asset.storageId}"` } : {}),
    };
  },
});

// Returns the deployment URLs visible to this component:
//   siteUrl  - CONVEX_SITE_URL (includes the component's mount prefix). Used
//              by the CLI to derive STATIC_HOSTING_BASE_PATH and to show
//              where the deployed app lives.
//   cloudUrl - CONVEX_CLOUD_URL. Used by the CLI as VITE_CONVEX_URL when
//              building the frontend.
export const getUrls = internalQuery({
  args: {},
  returns: v.object({
    siteUrl: v.string(),
    cloudUrl: v.string(),
  }),
  handler: async () => ({
    siteUrl: process.env.CONVEX_SITE_URL!,
    cloudUrl: process.env.CONVEX_CLOUD_URL!,
  }),
});

export const getByPath = internalQuery({
  args: { path: v.string() },
  returns: v.union(staticAssetValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("staticAssets")
      .withIndex("by_path", (q) => q.eq("path", args.path))
      .unique();
  },
});

// Resolves the asset the HTTP handler should serve for a request path: the
// exact match, or — when SPA fallback is enabled for the current deployment
// and the path looks like a client-side route (no file extension) — the
// index.html asset. Doing the fallback here keeps it to a single query.
export const resolveAsset = internalQuery({
  args: { path: v.string() },
  returns: v.union(staticAssetValidator, v.null()),
  handler: async (ctx, { path }) => {
    return await resolveAssetDocument(ctx, path);
  },
});

export const listAssets = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(staticAssetValidator),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("staticAssets")
      .order("asc")
      .take(args.limit ?? 100);
  },
});

export const generateUploadUrl = internalMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const generateUploadUrls = internalMutation({
  args: { count: v.number() },
  returns: v.array(v.string()),
  handler: async (ctx, { count }) => {
    const urls: string[] = [];
    for (let i = 0; i < count; i++) {
      urls.push(await ctx.storage.generateUploadUrl());
    }
    return urls;
  },
});

export const deleteUploadedFiles = internalMutation({
  args: { storageIds: v.array(v.id("_storage")) },
  returns: v.object({ deleted: v.number(), alreadyMissing: v.number() }),
  handler: async (ctx, { storageIds }) => {
    let deleted = 0;
    let alreadyMissing = 0;
    for (const storageId of storageIds) {
      if (await deleteStorageFile(ctx, storageId)) {
        deleted++;
      } else {
        alreadyMissing++;
      }
    }
    return { deleted, alreadyMissing };
  },
});

const recordAssetFields = {
  path: v.string(),
  storageId: v.optional(v.id("_storage")),
  blobId: v.optional(v.string()),
  contentType: v.string(),
  deploymentId: v.string(),
};

function assertAssetLocation({
  path,
  storageId,
  blobId,
}: {
  path: string;
  storageId?: Id<"_storage">;
  blobId?: string;
}) {
  if ((storageId === undefined) === (blobId === undefined)) {
    throw new Error(
      "Asset " + path + " must have exactly one of storageId or blobId",
    );
  }
}

function assertAssetManifest(
  assets: Array<{
    path: string;
    storageId?: Id<"_storage">;
    blobId?: string;
    deploymentId: string;
  }>,
  deploymentId?: string,
) {
  const paths = new Set<string>();
  for (const asset of assets) {
    assertAssetLocation(asset);
    if (paths.has(asset.path)) {
      throw new Error("Duplicate asset path: " + asset.path);
    }
    if (deploymentId !== undefined && asset.deploymentId !== deploymentId) {
      throw new Error("Asset " + asset.path + " has the wrong deploymentId");
    }
    paths.add(asset.path);
  }
}

async function setCurrentDeployment(
  ctx: MutationCtx,
  currentDeploymentId: string,
  spaFallback: boolean,
) {
  const existing = await ctx.db.query("deploymentInfo").first();
  if (existing) {
    await ctx.db.patch("deploymentInfo", existing._id, {
      currentDeploymentId,
      deployedAt: Date.now(),
      spaFallback,
    });
  } else {
    await ctx.db.insert("deploymentInfo", {
      currentDeploymentId,
      deployedAt: Date.now(),
      spaFallback,
    });
  }
}

export const recordAsset = internalMutation({
  args: recordAssetFields,
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    assertAssetLocation(args);
    const existing = await ctx.db
      .query("staticAssets")
      .withIndex("by_path", (q) => q.eq("path", args.path))
      .unique();
    if (existing) {
      if (existing.storageId) {
        await deleteStorageFile(ctx, existing.storageId);
      }
      await ctx.db.delete("staticAssets", existing._id);
    }
    await ctx.db.insert("staticAssets", {
      path: args.path,
      ...(args.storageId ? { storageId: args.storageId } : {}),
      ...(args.blobId ? { blobId: args.blobId } : {}),
      contentType: args.contentType,
      deploymentId: args.deploymentId,
    });
    return existing?.blobId ?? null;
  },
});

export const recordAssets = internalMutation({
  args: { assets: v.array(v.object(recordAssetFields)) },
  returns: v.object({ blobIds: v.array(v.string()) }),
  handler: async (ctx, { assets }) => {
    assertAssetManifest(assets);

    const blobIds: string[] = [];
    for (const asset of assets) {
      const existing = await ctx.db
        .query("staticAssets")
        .withIndex("by_path", (q) => q.eq("path", asset.path))
        .unique();
      if (existing) {
        if (existing.storageId) {
          await deleteStorageFile(ctx, existing.storageId);
        }
        if (existing.blobId) {
          blobIds.push(existing.blobId);
        }
        await ctx.db.delete("staticAssets", existing._id);
      }
      await ctx.db.insert("staticAssets", {
        path: asset.path,
        ...(asset.storageId ? { storageId: asset.storageId } : {}),
        ...(asset.blobId ? { blobId: asset.blobId } : {}),
        contentType: asset.contentType,
        deploymentId: asset.deploymentId,
      });
    }
    return { blobIds };
  },
});

// Publish the complete manifest, deployment metadata, and old-asset cleanup in
// one mutation. Until this succeeds, the previous deployment remains wholly
// live. Newly uploaded files are still unreferenced, so the CLI can safely
// delete them if this mutation fails.
export const publishDeployment = internalMutation({
  args: {
    assets: v.array(v.object(recordAssetFields)),
    currentDeploymentId: v.string(),
    spaFallback: v.optional(v.boolean()),
  },
  returns: v.object({
    deleted: v.number(),
    blobIds: v.array(v.string()),
  }),
  handler: async (ctx, { assets, currentDeploymentId, spaFallback }) => {
    assertAssetManifest(assets, currentDeploymentId);

    const oldAssets = await ctx.db.query("staticAssets").collect();
    const blobIds: string[] = [];
    let deleted = 0;
    for (const asset of oldAssets) {
      if (asset.storageId && (await deleteStorageFile(ctx, asset.storageId))) {
        deleted++;
      }
      if (asset.blobId) blobIds.push(asset.blobId);
      await ctx.db.delete("staticAssets", asset._id);
    }

    for (const asset of assets) {
      await ctx.db.insert("staticAssets", {
        path: asset.path,
        ...(asset.storageId ? { storageId: asset.storageId } : {}),
        ...(asset.blobId ? { blobId: asset.blobId } : {}),
        contentType: asset.contentType,
        deploymentId: asset.deploymentId,
      });
    }

    await setCurrentDeployment(ctx, currentDeploymentId, spaFallback ?? true);
    return { deleted, blobIds };
  },
});

// Commits a finished upload as the current deployment: records the deployment
// id + SPA config, then garbage-collects assets left over from previous
// deployments. Returns the storage cleanup tally plus any CDN blobIds the
// caller should delete (component actions can't reach the /fs blobs endpoint).
export const commitDeployment = internalMutation({
  args: {
    currentDeploymentId: v.string(),
    // Whether to serve SPA fallback for this deployment (default true).
    spaFallback: v.optional(v.boolean()),
  },
  returns: v.object({
    deleted: v.number(),
    blobIds: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const oldAssets = await ctx.db.query("staticAssets").collect();
    const blobIds: string[] = [];
    let deleted = 0;
    for (const asset of oldAssets) {
      if (asset.deploymentId === args.currentDeploymentId) continue;
      if (asset.storageId) {
        if (await deleteStorageFile(ctx, asset.storageId)) {
          deleted++;
        }
      }
      if (asset.blobId) {
        blobIds.push(asset.blobId);
      }
      await ctx.db.delete("staticAssets", asset._id);
    }

    await setCurrentDeployment(
      ctx,
      args.currentDeploymentId,
      args.spaFallback ?? true,
    );
    return { deleted, blobIds };
  },
});
