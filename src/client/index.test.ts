import { afterEach, describe, expect, test, vi } from "vitest";
import {
  componentsGeneric,
  httpActionGeneric,
  httpRouter,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import {
  decodeRequestPath,
  exposeDeploymentQuery,
  registerStaticRoutes,
  serveStaticAsset,
} from "./index.js";

const components = componentsGeneric() as unknown as {
  staticHosting: ComponentApi;
};

type TestHttpAction = {
  _handler: (
    ctx: { runQuery: ReturnType<typeof vi.fn> },
    request: Request,
  ) => Promise<Response>;
};

type TestQuery = {
  _handler: (
    ctx: { runQuery: ReturnType<typeof vi.fn> },
    args: Record<string, never>,
  ) => Promise<unknown>;
};

function invokeHandler(
  handler: object,
  runQuery: ReturnType<typeof vi.fn>,
  request: Request,
) {
  return (handler as TestHttpAction)._handler({ runQuery }, request);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function staticHandler(path = "/") {
  const http = httpRouter();
  registerStaticRoutes(http, components.staticHosting, { pathPrefix: path });
  const route = http.lookup(path, "GET");
  if (!route) throw new Error(`No static route registered for ${path}`);
  return route[0];
}

describe("registerStaticRoutes", () => {
  test("keeps exact app routes ahead of the static catch-all", () => {
    const http = httpRouter();
    const authHandler = httpActionGeneric(async () => new Response("auth"));
    http.route({ path: "/auth/callback", method: "GET", handler: authHandler });

    registerStaticRoutes(http, components.staticHosting);

    expect(http.lookup("/auth/callback", "GET")?.[0]).toBe(authHandler);
    expect(http.lookup("/dashboard", "GET")?.[0]).not.toBe(authHandler);
  });

  test("serves component-owned storage at the root", async () => {
    const handler = staticHandler();
    const runQuery = vi.fn().mockResolvedValue({
      storageUrl: "https://storage.example/index",
      contentType: "text/html; charset=utf-8",
      etag: '"storage-id"',
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<h1>Hello</h1>")),
    );

    const response = await invokeHandler(
      handler,
      runQuery,
      new Request("https://app.convex.site/"),
    );

    expect(runQuery).toHaveBeenCalledWith(
      components.staticHosting.lib.resolveAssetForHttp,
      { path: "/index.html" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe('"storage-id"');
    expect(await response.text()).toBe("<h1>Hello</h1>");
  });

  test("serves an inherited v1 asset from the app's storage during migration", async () => {
    const handler = staticHandler();
    const runQuery = vi.fn().mockResolvedValue({
      appStorageId: "app-storage-id",
      contentType: "text/html; charset=utf-8",
      etag: '"app-storage-id"',
    });
    const storageGet = vi.fn().mockResolvedValue(new Blob(["<h1>v1</h1>"]));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ctx = { runQuery, storage: { get: storageGet } };

    const response = await (
      handler as unknown as {
        _handler: (c: typeof ctx, r: Request) => Promise<Response>;
      }
    )._handler(ctx, new Request("https://app.convex.site/"));

    expect(response.status).toBe(200);
    expect(storageGet).toHaveBeenCalledWith("app-storage-id");
    // The file is read from app storage directly, never via a storage URL fetch.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.get("ETag")).toBe('"app-storage-id"');
    expect(await response.text()).toBe("<h1>v1</h1>");
  });

  test("returns 304 for an inherited v1 asset without reading app storage", async () => {
    const handler = staticHandler();
    const runQuery = vi.fn().mockResolvedValue({
      appStorageId: "app-storage-id",
      contentType: "text/html; charset=utf-8",
      etag: '"app-storage-id"',
    });
    const storageGet = vi.fn();
    const ctx = { runQuery, storage: { get: storageGet } };

    const response = await (
      handler as unknown as {
        _handler: (c: typeof ctx, r: Request) => Promise<Response>;
      }
    )._handler(
      ctx,
      new Request("https://app.convex.site/", {
        headers: { "If-None-Match": '"app-storage-id"' },
      }),
    );

    expect(response.status).toBe(304);
    expect(storageGet).not.toHaveBeenCalled();
  });

  test.each([
    ["/", 503],
    ["/legacy.js", 404],
  ])(
    "treats an inherited v1 file missing from app storage as missing: %s",
    async (path, status) => {
      const handler = staticHandler();
      const runQuery = vi.fn().mockResolvedValue({
        appStorageId: "deleted-storage-id",
        contentType: "application/javascript; charset=utf-8",
      });
      const ctx = {
        runQuery,
        storage: { get: vi.fn().mockResolvedValue(null) },
      };

      const response = await (
        handler as unknown as {
          _handler: (c: typeof ctx, r: Request) => Promise<Response>;
        }
      )._handler(ctx, new Request(`https://app.convex.site${path}`));

      expect(response.status).toBe(status);
    },
  );

  test("returns a non-cacheable 503 setup page before the first upload", async () => {
    const handler = staticHandler();
    const runQuery = vi.fn().mockResolvedValue(null);

    const response = await invokeHandler(
      handler,
      runQuery,
      new Request("https://app.convex.site/"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(await response.text()).toContain(
      "no static files have been deployed",
    );
  });

  test("returns the setup page at the exact compatibility prefix", async () => {
    const http = httpRouter();
    registerStaticRoutes(http, components.staticHosting, {
      pathPrefix: "/app/",
    });
    const handler = http.lookup("/app", "GET")?.[0];
    if (!handler) throw new Error("No exact prefixed route registered");

    const response = await invokeHandler(
      handler,
      vi.fn().mockResolvedValue(null),
      new Request("https://app.convex.site/app"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("5");
  });

  test("decodes percent-encoded paths before resolving assets", async () => {
    const handler = staticHandler();
    const runQuery = vi.fn().mockResolvedValue(null);

    await invokeHandler(
      handler,
      runQuery,
      new Request("https://app.convex.site/docs/hello%20world.txt"),
    );

    expect(runQuery).toHaveBeenCalledWith(
      components.staticHosting.lib.resolveAssetForHttp,
      { path: "/docs/hello world.txt" },
    );
  });

  test("rejects malformed percent encoding before querying the component", async () => {
    const handler = staticHandler();
    const runQuery = vi.fn();

    const response = await invokeHandler(
      handler,
      runQuery,
      new Request("https://app.convex.site/bad%ZZpath"),
    );

    expect(response.status).toBe(400);
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("strips a path prefix and forwards the SPA override", async () => {
    const http = httpRouter();
    registerStaticRoutes(http, components.staticHosting, {
      pathPrefix: "/app/",
      spaFallback: false,
    });
    const handler = http.lookup("/app/dashboard", "GET")?.[0];
    if (!handler) throw new Error("No prefixed static route registered");
    const runQuery = vi.fn().mockResolvedValue(null);

    const response = await invokeHandler(
      handler,
      runQuery,
      new Request("https://app.convex.site/app/dashboard"),
    );

    expect(runQuery).toHaveBeenCalledWith(
      components.staticHosting.lib.resolveAssetForHttp,
      { path: "/dashboard", spaFallback: false },
    );
    expect(response.status).toBe(404);
  });

  test("returns 304 for a weak ETag in a validator list", async () => {
    const handler = staticHandler();
    const runQuery = vi.fn().mockResolvedValue({
      storageUrl: "https://storage.example/app.js",
      contentType: "application/javascript; charset=utf-8",
      etag: '"storage-id"',
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await invokeHandler(
      handler,
      runQuery,
      new Request("https://app.convex.site/app.js", {
        headers: {
          "If-None-Match": '"not-current", W/"storage-id"',
        },
      }),
    );

    expect(response.status).toBe(304);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("preserves the custom CDN redirect option", async () => {
    const http = httpRouter();
    registerStaticRoutes(http, components.staticHosting, {
      cdnBaseUrl: "https://cdn.example/blobs/",
    });
    const handler = http.lookup("/app-HASHED1.js", "GET")?.[0];
    if (!handler) throw new Error("No static route registered");
    const runQuery = vi.fn().mockResolvedValue({
      blobId: "blob-1",
      contentType: "application/javascript; charset=utf-8",
    });

    const response = await invokeHandler(
      handler,
      runQuery,
      new Request("https://app.convex.site/app-HASHED1.js"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://cdn.example/blobs/blob-1",
    );
  });
});

describe("serveStaticAsset", () => {
  type ServeCtx = Parameters<typeof serveStaticAsset>[0];

  function serveCtx(
    runQuery: ReturnType<typeof vi.fn>,
    storageGet: ReturnType<typeof vi.fn> = vi.fn(),
  ) {
    return { runQuery, storage: { get: storageGet } } as unknown as ServeCtx;
  }

  test("serves an exact file with the registerStaticRoutes headers", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      storageUrl: "https://storage.example/app",
      contentType: "application/javascript; charset=utf-8",
      etag: '"storage-id"',
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("app()")));

    const response = await serveStaticAsset(
      serveCtx(runQuery),
      components.staticHosting,
      new Request("https://app.convex.site/assets/app-B71cUw87.js"),
    );

    expect(runQuery).toHaveBeenCalledWith(
      components.staticHosting.lib.resolveAssetForHttp,
      { path: "/assets/app-B71cUw87.js", spaFallback: false },
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response?.headers.get("ETag")).toBe('"storage-id"');
    expect(response?.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response?.text()).toBe("app()");
  });

  test("returns null instead of a setup page or 404", async () => {
    const runQuery = vi.fn().mockResolvedValue(null);

    for (const url of ["/", "/missing.js", "/dashboard"]) {
      const response = await serveStaticAsset(
        serveCtx(runQuery),
        components.staticHosting,
        new Request(`https://app.convex.site${url}`),
      );
      expect(response).toBeNull();
    }
    // An exact lookup: `/` is not mapped to `/index.html`.
    expect(runQuery).toHaveBeenCalledWith(
      components.staticHosting.lib.resolveAssetForHttp,
      { path: "/", spaFallback: false },
    );
  });

  test("serves the SPA shell only for an explicit path", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      storageUrl: "https://storage.example/index",
      contentType: "text/html; charset=utf-8",
      etag: '"index-id"',
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<div id=root>")),
    );

    const response = await serveStaticAsset(
      serveCtx(runQuery),
      components.staticHosting,
      new Request("https://app.convex.site/dashboard/settings"),
      { path: "/index.html" },
    );

    expect(runQuery).toHaveBeenCalledWith(
      components.staticHosting.lib.resolveAssetForHttp,
      { path: "/index.html", spaFallback: false },
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Cache-Control")).toBe(
      "public, max-age=0, must-revalidate",
    );
  });

  test("forwards an explicit SPA fallback opt-in", async () => {
    const runQuery = vi.fn().mockResolvedValue(null);

    await serveStaticAsset(
      serveCtx(runQuery),
      components.staticHosting,
      new Request("https://app.convex.site/dashboard"),
      { spaFallback: true },
    );

    expect(runQuery).toHaveBeenCalledWith(
      components.staticHosting.lib.resolveAssetForHttp,
      { path: "/dashboard", spaFallback: true },
    );
  });

  test("returns null for malformed percent-encoding without querying", async () => {
    const runQuery = vi.fn();

    const response = await serveStaticAsset(
      serveCtx(runQuery),
      components.staticHosting,
      new Request("https://app.convex.site/caf%E9"),
    );

    expect(response).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("rejects a path without a leading slash", async () => {
    await expect(
      serveStaticAsset(
        serveCtx(vi.fn()),
        components.staticHosting,
        new Request("https://app.convex.site/about"),
        { path: "about/index.html" },
      ),
    ).rejects.toThrow("path must start with /");
  });

  test("keeps ETag revalidation and CDN redirects", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        storageUrl: "https://storage.example/app",
        contentType: "application/javascript; charset=utf-8",
        etag: '"storage-id"',
      })
      .mockResolvedValueOnce({
        blobId: "blob-1",
        contentType: "application/javascript; charset=utf-8",
      });

    const revalidated = await serveStaticAsset(
      serveCtx(runQuery),
      components.staticHosting,
      new Request("https://app.convex.site/app.js", {
        headers: { "If-None-Match": '"storage-id"' },
      }),
    );
    const redirected = await serveStaticAsset(
      serveCtx(runQuery),
      components.staticHosting,
      new Request("https://app.convex.site/app-HASHED1.js"),
      { cdnBaseUrl: "https://cdn.example/blobs/" },
    );

    expect(revalidated?.status).toBe(304);
    expect(redirected?.status).toBe(302);
    expect(redirected?.headers.get("Location")).toBe(
      "https://cdn.example/blobs/blob-1",
    );
  });

  test("returns null for an inherited v1 file missing from app storage", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      appStorageId: "deleted-storage-id",
      contentType: "application/javascript; charset=utf-8",
      etag: '"deleted-storage-id"',
    });
    const storageGet = vi.fn().mockResolvedValue(null);

    const response = await serveStaticAsset(
      serveCtx(runQuery, storageGet),
      components.staticHosting,
      new Request("https://app.convex.site/legacy.js"),
    );

    expect(storageGet).toHaveBeenCalledWith("deleted-storage-id");
    expect(response).toBeNull();
  });

  test("lets an app action fall through to its own rendering", async () => {
    const render = vi.fn(
      async (request: Request) =>
        new Response(`rendered ${new URL(request.url).pathname}`),
    );
    const handler = httpActionGeneric(async (ctx, request) => {
      const file = await serveStaticAsset(
        ctx,
        components.staticHosting,
        request,
      );
      if (file) return file;
      const path = decodeRequestPath(new URL(request.url).pathname);
      if (path === null || path.startsWith("/assets/")) {
        return new Response("Not Found", { status: 404 });
      }
      return await render(request);
    });
    const runQuery = vi.fn().mockResolvedValue(null);

    const page = await invokeHandler(
      handler,
      runQuery,
      new Request("https://app.convex.site/about"),
    );
    // An encoded `/assets/` path is still a missing asset, not a page.
    const staleAsset = await invokeHandler(
      handler,
      runQuery,
      new Request("https://app.convex.site/%61ssets/app-OLDHASH.js"),
    );

    expect(await page.text()).toBe("rendered /about");
    expect(staleAsset.status).toBe(404);
    expect(render).toHaveBeenCalledTimes(1);
  });
});

describe("exposeDeploymentQuery", () => {
  test("strips private cleanup accounting from the public result", async () => {
    const { getCurrentDeployment } = exposeDeploymentQuery(
      components.staticHosting,
    );
    const runQuery = vi.fn().mockResolvedValue({
      _id: "deployment-info-id",
      _creationTime: 1,
      currentDeploymentId: "deploy-1",
      deployedAt: 2,
      spaFallback: true,
      pendingBlobCleanupCount: 4,
    });

    const result = await (
      getCurrentDeployment as unknown as TestQuery
    )._handler({ runQuery }, {});

    expect(result).toEqual({
      _id: "deployment-info-id",
      _creationTime: 1,
      currentDeploymentId: "deploy-1",
      deployedAt: 2,
      spaFallback: true,
    });
  });
});
