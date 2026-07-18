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
        .index("by_deploymentId", ["deploymentId"]),
    // Singleton table to track the current deployment
    // Clients subscribe to this to know when to reload
    deploymentInfo: defineTable({
        currentDeploymentId: v.string(),
        deployedAt: v.number(), // timestamp
        // Forward-compat only: 0.2.x writes this field. 0.1.x ignores it, but the
        // field must be allowed here so that if a deployment is upgraded to 0.2.x
        // and then rolled back to 0.1.x, the existing deploymentInfo row still
        // validates. See CHANGELOG 0.1.5.
        spaFallback: v.optional(v.boolean()),
    }),
});
//# sourceMappingURL=schema.js.map