import { defineComponent } from "convex/server";
import { v } from "convex/values";

export default defineComponent("staticHosting", {
  env: {
    // Control the SPA fallback behavior: "disabled" returns 404s instead of serving index.html.
    STATIC_HOSTING_SPA_FALLBACK: v.optional(
      v.union(v.literal("enabled"), v.literal("disabled")),
    ),
  },
});
