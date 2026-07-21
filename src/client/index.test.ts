import { afterEach, describe, expect, test, vi } from "vitest";
import {
  componentsGeneric,
  httpActionGeneric,
  httpRouter,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import { registerStaticRoutes } from "./index.js";

const components = componentsGeneric() as unknown as {
  staticHosting: ComponentApi;
};

type TestHttpAction = {
  _handler: (
    ctx: { runQuery: ReturnType<typeof vi.fn> },
    request: Request,
  ) => Promise<Response>;
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
