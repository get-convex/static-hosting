import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server.js";

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
});

export const getCurrentDeployment = query({
  args: {},
  returns: v.union(deploymentInfoValidator, v.null()),
  handler: async (ctx) => {
    return await ctx.db.query("deploymentInfo").first();
  },
});

export const getBasePath = internalQuery({
  args: {},
  returns: v.string(),
  handler: async () => {
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!siteUrl) return "/";
    try {
      const pathname = new URL(siteUrl).pathname;
      return pathname || "/";
    } catch {
      return "/";
    }
  },
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

const recordAssetFields = {
  path: v.string(),
  storageId: v.optional(v.id("_storage")),
  blobId: v.optional(v.string()),
  contentType: v.string(),
  deploymentId: v.string(),
};

export const recordAsset = internalMutation({
  args: recordAssetFields,
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("staticAssets")
      .withIndex("by_path", (q) => q.eq("path", args.path))
      .unique();
    if (existing) {
      if (existing.storageId) {
        await ctx.storage.delete(existing.storageId);
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
    return null;
  },
});

export const recordAssets = internalMutation({
  args: { assets: v.array(v.object(recordAssetFields)) },
  returns: v.null(),
  handler: async (ctx, { assets }) => {
    for (const asset of assets) {
      const existing = await ctx.db
        .query("staticAssets")
        .withIndex("by_path", (q) => q.eq("path", asset.path))
        .unique();
      if (existing) {
        if (existing.storageId) {
          await ctx.storage.delete(existing.storageId);
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
    return null;
  },
});

export const gcOldAssets = internalMutation({
  args: { currentDeploymentId: v.string() },
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
        await ctx.storage.delete(asset.storageId);
        deleted++;
      }
      if (asset.blobId) {
        blobIds.push(asset.blobId);
      }
      await ctx.db.delete("staticAssets", asset._id);
    }

    const existing = await ctx.db.query("deploymentInfo").first();
    if (existing) {
      await ctx.db.patch("deploymentInfo", existing._id, {
        currentDeploymentId: args.currentDeploymentId,
        deployedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("deploymentInfo", {
        currentDeploymentId: args.currentDeploymentId,
        deployedAt: Date.now(),
      });
    }
    return { deleted, blobIds };
  },
});
