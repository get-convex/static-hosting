import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  staticAssets: defineTable({
    path: v.string(), // URL path, e.g., "/index.html", "/assets/main-abc123.js"
    storageId: v.optional(v.id("_storage")), // Reference to Convex file storage (used for HTML + non-CDN assets)
    blobId: v.optional(v.string()), // convex-fs blob ID (used for CDN-served assets)
    contentType: v.string(), // MIME type, e.g., "text/html; charset=utf-8"
    deploymentId: v.string(), // UUID for garbage collection
  })
    .index("by_path", ["path"])
    .index("by_deploymentId", ["deploymentId"])
    .index("by_storageId", ["storageId"]),

  // Uploads stage their manifest in small chunks because the Convex CLI takes
  // function arguments on the command line. Only publishDeployment copies a
  // complete staged manifest into staticAssets, so partial uploads are never
  // visible to HTTP requests.
  stagedAssets: defineTable({
    path: v.string(),
    storageId: v.optional(v.id("_storage")),
    blobId: v.optional(v.string()),
    contentType: v.string(),
    deploymentId: v.string(),
  })
    .index("by_deploymentId", ["deploymentId"])
    .index("by_storageId", ["storageId"]),

  // Old ConvexFS blobs are app-owned, so the component cannot delete them.
  // Persist the IDs until the CLI's app-level delete function succeeds. This
  // also makes cleanup recoverable when a publish response is lost.
  pendingBlobCleanup: defineTable({
    blobId: v.string(),
  }).index("by_blobId", ["blobId"]),

  // Storage IDs from the previous live manifest are queued by the atomic
  // publish, then deleted in bounded follow-up mutations. This avoids both a
  // large publish transaction and races with unrelated concurrent uploads.
  pendingStorageCleanup: defineTable({
    storageId: v.id("_storage"),
  }).index("by_storageId", ["storageId"]),

  // Cleanup may be queued before the first successful deployment exists, so
  // its count cannot live only on deploymentInfo.
  cleanupState: defineTable({
    pendingBlobCleanupCount: v.number(),
  }),

  // Singleton table to track the current deployment
  // Clients subscribe to this to know when to reload
  deploymentInfo: defineTable({
    currentDeploymentId: v.string(),
    deployedAt: v.number(), // timestamp
    // SPA fallback config for the current deployment. Set at upload time
    // (`--no-spa` turns it off). Absent means enabled. Travels with the
    // deploy so the serving behavior matches the code that was shipped.
    spaFallback: v.optional(v.boolean()),
    pendingBlobCleanupCount: v.optional(v.number()),
  }),
});
