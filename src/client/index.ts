import {
  httpActionGeneric,
  queryGeneric,
  type HttpRouter,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import {
  cacheControlFor,
  getMimeType,
  getSetupHtml,
  isHtmlContentType,
} from "../component/serving.js";

/**
 * Register app-owned HTTP routes for static hosting.
 *
 * Prefer mounting the component's own HTTP routes when it can own the URL
 * prefix. Use this compatibility mode when existing app HTTP routes must stay
 * at the same root. Exact app routes take precedence over this catch-all.
 * Assets and deployment state still live in the component.
 *
 * @example
 * ```typescript
 * // convex/convex.config.ts
 * const app = defineApp();
 * app.use(staticHosting); // no httpPrefix: the app owns HTTP routing
 *
 * // convex/http.ts
 * const http = httpRouter();
 * auth.addHttpRoutes(http);
 * registerStaticRoutes(http, components.staticHosting);
 * export default http;
 * ```
 */
export function registerStaticRoutes(
  http: HttpRouter,
  component: ComponentApi,
  {
    pathPrefix = "/",
    spaFallback,
    cdnBaseUrl,
  }: {
    /** URL prefix where the app should serve static files. */
    pathPrefix?: string;
    /** Override the deployment's SPA fallback setting. */
    spaFallback?: boolean;
    /** Optional custom base URL for convex-fs blob redirects. */
    cdnBaseUrl?: string | ((request: Request) => string);
  } = {},
) {
  if (!pathPrefix.startsWith("/")) {
    throw new Error("pathPrefix must start with /");
  }

  const normalizedPrefix =
    pathPrefix === "/" ? "" : pathPrefix.replace(/\/$/, "");

  const serveStaticFile = httpActionGeneric(async (ctx, request) => {
    const url = new URL(request.url);
    let path = url.pathname;

    if (normalizedPrefix && path.startsWith(normalizedPrefix)) {
      path = path.slice(normalizedPrefix.length) || "/";
    }
    if (path === "" || path === "/") {
      path = "/index.html";
    }

    const asset = await ctx.runQuery(component.lib.resolveAssetForHttp, {
      path,
      ...(spaFallback === undefined ? {} : { spaFallback }),
    });

    if (!asset) {
      if (path === "/index.html") {
        return new Response(getSetupHtml(), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return new Response("Not Found", {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const contentType = asset.contentType || getMimeType(path);
    const cacheControl = cacheControlFor(path);

    if (asset.blobId && !isHtmlContentType(contentType)) {
      const configuredBase =
        typeof cdnBaseUrl === "function" ? cdnBaseUrl(request) : cdnBaseUrl;
      const baseUrl = configuredBase ?? `${url.origin}/fs/blobs`;
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${baseUrl.replace(/\/$/, "")}/${asset.blobId}`,
          "Cache-Control": cacheControl,
        },
      });
    }

    if (!asset.storageUrl) {
      return new Response("Asset not available", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }

    if (asset.etag && request.headers.get("If-None-Match") === asset.etag) {
      return new Response(null, {
        status: 304,
        headers: { ETag: asset.etag, "Cache-Control": cacheControl },
      });
    }

    const storageResponse = await fetch(asset.storageUrl);
    if (!storageResponse.ok || !storageResponse.body) {
      return new Response("Storage error", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }

    return new Response(storageResponse.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
        ...(asset.etag ? { ETag: asset.etag } : {}),
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  http.route({
    pathPrefix: pathPrefix === "/" ? "/" : `${normalizedPrefix}/`,
    method: "GET",
    handler: serveStaticFile,
  });

  if (normalizedPrefix) {
    http.route({
      path: normalizedPrefix,
      method: "GET",
      handler: serveStaticFile,
    });
  }
}

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
