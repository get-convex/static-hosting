import { queryGeneric } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";

/**
 * Expose a query that clients can subscribe to for live reload on deploy.
 * This is only needed if you use `UpdateBanner` / `useDeploymentUpdates` from
 * `@convex-dev/static-hosting/react`. If you don't surface deployment updates
 * in your app, you don't need to call this.
 *
 * @example
 * ```typescript
 * // convex/staticHosting.ts
 * import { exposeDeploymentQuery } from "@convex-dev/static-hosting";
 * import { components } from "./_generated/api";
 *
 * export const { getCurrentDeployment } = exposeDeploymentQuery(
 *   components.staticHosting,
 * );
 * ```
 */
export function exposeDeploymentQuery(component: ComponentApi) {
  return {
    getCurrentDeployment: queryGeneric({
      args: {},
      handler: async (ctx) => {
        return await ctx.runQuery(component.lib.getCurrentDeployment, {});
      },
    }),
  };
}

/**
 * Derive the Convex cloud URL from a `.convex.site` hostname.
 * Useful when your frontend is served from Convex static hosting and needs
 * to connect to its own Convex backend without an explicit env var.
 *
 * @example
 * ```typescript
 * import { getConvexUrl } from "@convex-dev/static-hosting";
 *
 * const convexUrl = import.meta.env.VITE_CONVEX_URL ?? getConvexUrl();
 * const convex = new ConvexReactClient(convexUrl);
 * ```
 */
export function getConvexUrl(): string {
  if (typeof window === "undefined") {
    throw new Error("getConvexUrl() can only be called in a browser context");
  }
  if (window.location.hostname.endsWith(".convex.site")) {
    return `https://${window.location.hostname.replace(".convex.site", ".convex.cloud")}`;
  }
  throw new Error(
    "Unable to derive Convex URL. Please set VITE_CONVEX_URL environment variable.",
  );
}
