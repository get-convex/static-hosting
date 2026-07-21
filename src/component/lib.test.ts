/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

describe("component lib", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("generates upload URLs", async () => {
    const t = initConvexTest();
    const uploadUrl = await t.mutation(internal.lib.generateUploadUrl, {});
    expect(typeof uploadUrl).toBe("string");
    expect(uploadUrl.length).toBeGreaterThan(0);

    const urls = await t.mutation(internal.lib.generateUploadUrls, {
      count: 3,
    });
    expect(urls).toHaveLength(3);
    for (const u of urls) {
      expect(typeof u).toBe("string");
    }
  });

  test("getByPath returns null when absent", async () => {
    const t = initConvexTest();
    const asset = await t.query(internal.lib.getByPath, {
      path: "/index.html",
    });
    expect(asset).toBeNull();
  });

  test("listAssets is empty by default", async () => {
    const t = initConvexTest();
    const assets = await t.query(internal.lib.listAssets, {});
    expect(assets).toHaveLength(0);
  });

  test("commitDeployment on empty db returns zero", async () => {
    const t = initConvexTest();
    const result = await t.mutation(internal.lib.commitDeployment, {
      currentDeploymentId: "deploy-1",
    });
    expect(result.deleted).toBe(0);
    expect(result.blobIds).toHaveLength(0);
  });

  test("recordAsset stores and replaces blob assets", async () => {
    const t = initConvexTest();

    await t.mutation(internal.lib.recordAsset, {
      path: "/test.js",
      blobId: "blob-123",
      contentType: "application/javascript; charset=utf-8",
      deploymentId: "deploy-1",
    });

    const first = await t.query(internal.lib.getByPath, { path: "/test.js" });
    expect(first?.blobId).toBe("blob-123");

    await t.mutation(internal.lib.recordAsset, {
      path: "/test.js",
      blobId: "blob-456",
      contentType: "application/javascript; charset=utf-8",
      deploymentId: "deploy-2",
    });

    const second = await t.query(internal.lib.getByPath, { path: "/test.js" });
    expect(second?.blobId).toBe("blob-456");
  });

  test("replaces a legacy or already-deleted storage reference", async () => {
    const t = initConvexTest();
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["old"]));
    });
    await t.mutation(internal.lib.recordAsset, {
      path: "/index.html",
      storageId,
      contentType: "text/html; charset=utf-8",
      deploymentId: "deploy-old",
    });
    await t.run(async (ctx) => {
      await ctx.storage.delete(storageId);
    });

    await expect(
      t.mutation(internal.lib.recordAsset, {
        path: "/index.html",
        blobId: "replacement",
        contentType: "text/html; charset=utf-8",
        deploymentId: "deploy-new",
      }),
    ).resolves.toBeNull();
  });

  test("commitDeployment returns blobIds for old CDN assets and bumps deployment", async () => {
    const t = initConvexTest();

    await t.mutation(internal.lib.recordAsset, {
      path: "/assets/main.js",
      blobId: "blob-abc",
      contentType: "application/javascript; charset=utf-8",
      deploymentId: "deploy-old",
    });

    const result = await t.mutation(internal.lib.commitDeployment, {
      currentDeploymentId: "deploy-new",
    });
    expect(result.deleted).toBe(0);
    expect(result.blobIds).toEqual(["blob-abc"]);

    const deployment = await t.query(api.lib.getCurrentDeployment, {});
    expect(deployment?.currentDeploymentId).toBe("deploy-new");
  });

  test("commitDeployment skips a legacy or already-deleted storage ID", async () => {
    const t = initConvexTest();
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["legacy"]));
    });
    await t.mutation(internal.lib.recordAsset, {
      path: "/legacy.css",
      storageId,
      contentType: "text/css; charset=utf-8",
      deploymentId: "deploy-old",
    });
    await t.run(async (ctx) => {
      await ctx.storage.delete(storageId);
    });

    const result = await t.mutation(internal.lib.commitDeployment, {
      currentDeploymentId: "deploy-new",
    });

    expect(result).toEqual({ deleted: 0, blobIds: [] });
    expect(await t.query(internal.lib.listAssets, {})).toEqual([]);
  });

  test("deletes newly uploaded files after a failed publish", async () => {
    const t = initConvexTest();
    const [first, alreadyMissing] = await t.run(async (ctx) => {
      return await Promise.all([
        ctx.storage.store(new Blob(["first"])),
        ctx.storage.store(new Blob(["missing"])),
      ]);
    });
    await t.run(async (ctx) => {
      await ctx.storage.delete(alreadyMissing);
    });

    const result = await t.mutation(internal.lib.deleteUploadedFiles, {
      storageIds: [first, alreadyMissing],
    });

    expect(result).toEqual({ deleted: 1, alreadyMissing: 1 });
    await t.run(async (ctx) => {
      expect(await ctx.storage.get(first)).toBeNull();
    });
  });

  test("publishes the manifest, deployment info, and cleanup atomically", async () => {
    const t = initConvexTest();
    const oldStorageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["old"]));
    });
    await t.mutation(internal.lib.recordAssets, {
      assets: [
        {
          path: "/old.css",
          storageId: oldStorageId,
          contentType: "text/css; charset=utf-8",
          deploymentId: "deploy-old",
        },
        {
          path: "/old.js",
          blobId: "old-cdn-blob",
          contentType: "application/javascript; charset=utf-8",
          deploymentId: "deploy-old",
        },
      ],
    });
    const newStorageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["new"]));
    });

    const result = await t.mutation(internal.lib.publishDeployment, {
      assets: [
        {
          path: "/index.html",
          storageId: newStorageId,
          contentType: "text/html; charset=utf-8",
          deploymentId: "deploy-new",
        },
      ],
      currentDeploymentId: "deploy-new",
      spaFallback: false,
    });

    expect(result).toEqual({ deleted: 1, blobIds: ["old-cdn-blob"] });
    expect(await t.query(internal.lib.listAssets, {})).toMatchObject([
      {
        path: "/index.html",
        storageId: newStorageId,
        deploymentId: "deploy-new",
      },
    ]);
    expect(await t.query(api.lib.getCurrentDeployment, {})).toMatchObject({
      currentDeploymentId: "deploy-new",
      spaFallback: false,
    });
    await t.run(async (ctx) => {
      expect(await ctx.storage.get(oldStorageId)).toBeNull();
      expect(await ctx.storage.get(newStorageId)).not.toBeNull();
    });
  });

  test("rejects an invalid publish without changing the live manifest", async () => {
    const t = initConvexTest();
    await t.mutation(internal.lib.recordAsset, {
      path: "/index.html",
      blobId: "still-live",
      contentType: "text/html; charset=utf-8",
      deploymentId: "deploy-old",
    });

    await expect(
      t.mutation(internal.lib.publishDeployment, {
        assets: [
          {
            path: "/index.html",
            blobId: "not-published",
            contentType: "text/html; charset=utf-8",
            deploymentId: "wrong-deployment",
          },
        ],
        currentDeploymentId: "deploy-new",
      }),
    ).rejects.toThrow("wrong deploymentId");

    expect(
      await t.query(internal.lib.getByPath, { path: "/index.html" }),
    ).toMatchObject({ blobId: "still-live", deploymentId: "deploy-old" });
  });

  test("recordAssets batches multiple inserts", async () => {
    const t = initConvexTest();

    const result = await t.mutation(internal.lib.recordAssets, {
      assets: [
        {
          path: "/a.js",
          blobId: "blob-a",
          contentType: "application/javascript; charset=utf-8",
          deploymentId: "deploy-1",
        },
        {
          path: "/b.css",
          blobId: "blob-b",
          contentType: "text/css; charset=utf-8",
          deploymentId: "deploy-1",
        },
      ],
    });

    expect(result).toEqual({ blobIds: [] });
    const all = await t.query(internal.lib.listAssets, {});
    expect(all).toHaveLength(2);
  });

  test("recordAssets returns replaced CDN blobs for cleanup", async () => {
    const t = initConvexTest();
    await t.mutation(internal.lib.recordAsset, {
      path: "/app.js",
      blobId: "old-blob",
      contentType: "application/javascript; charset=utf-8",
      deploymentId: "deploy-old",
    });

    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["new"]));
    });
    const result = await t.mutation(internal.lib.recordAssets, {
      assets: [
        {
          path: "/app.js",
          storageId,
          contentType: "application/javascript; charset=utf-8",
          deploymentId: "deploy-new",
        },
      ],
    });

    expect(result).toEqual({ blobIds: ["old-blob"] });
    const current = await t.query(internal.lib.getByPath, { path: "/app.js" });
    expect(current?.storageId).toBe(storageId);
    expect(current?.blobId).toBeUndefined();
  });

  test("recordAssets rejects ambiguous locations and duplicate paths", async () => {
    const t = initConvexTest();

    await expect(
      t.mutation(internal.lib.recordAssets, {
        assets: [
          {
            path: "/missing-location.js",
            contentType: "application/javascript; charset=utf-8",
            deploymentId: "deploy-1",
          },
        ],
      }),
    ).rejects.toThrow("exactly one of storageId or blobId");

    await expect(
      t.mutation(internal.lib.recordAssets, {
        assets: [
          {
            path: "/duplicate.js",
            blobId: "blob-a",
            contentType: "application/javascript; charset=utf-8",
            deploymentId: "deploy-1",
          },
          {
            path: "/duplicate.js",
            blobId: "blob-b",
            contentType: "application/javascript; charset=utf-8",
            deploymentId: "deploy-1",
          },
        ],
      }),
    ).rejects.toThrow("Duplicate asset path");
  });

  describe("resolveAsset", () => {
    async function seedIndex(t: ReturnType<typeof initConvexTest>) {
      await t.mutation(internal.lib.recordAsset, {
        path: "/index.html",
        blobId: "blob-index",
        contentType: "text/html; charset=utf-8",
        deploymentId: "deploy-1",
      });
    }

    test("returns the exact match when present", async () => {
      const t = initConvexTest();
      await t.mutation(internal.lib.recordAsset, {
        path: "/assets/app-B71cUw87.js",
        blobId: "blob-app",
        contentType: "application/javascript; charset=utf-8",
        deploymentId: "deploy-1",
      });

      const asset = await t.query(internal.lib.resolveAsset, {
        path: "/assets/app-B71cUw87.js",
      });
      expect(asset?.path).toBe("/assets/app-B71cUw87.js");
    });

    test("falls back to index.html for extension-less misses by default", async () => {
      const t = initConvexTest();
      await seedIndex(t);

      const asset = await t.query(internal.lib.resolveAsset, {
        path: "/dashboard/settings",
      });
      expect(asset?.path).toBe("/index.html");
    });

    test("does not fall back for paths with an extension", async () => {
      const t = initConvexTest();
      await seedIndex(t);

      const asset = await t.query(internal.lib.resolveAsset, {
        path: "/missing.js",
      });
      expect(asset).toBeNull();
    });

    test("does not fall back when the deployment disables it", async () => {
      const t = initConvexTest();
      await seedIndex(t);
      await t.mutation(internal.lib.commitDeployment, {
        currentDeploymentId: "deploy-1",
        spaFallback: false,
      });

      const asset = await t.query(internal.lib.resolveAsset, {
        path: "/dashboard",
      });
      expect(asset).toBeNull();
    });

    test("returns a storage URL for app-owned HTTP routes", async () => {
      const t = initConvexTest();
      const storageId = await t.run(async (ctx) => {
        return await ctx.storage.store(
          new Blob(["<h1>Hello</h1>"], { type: "text/html" }),
        );
      });
      await t.mutation(internal.lib.recordAsset, {
        path: "/index.html",
        storageId,
        contentType: "text/html; charset=utf-8",
        deploymentId: "deploy-1",
      });

      const asset = await t.query(api.lib.resolveAssetForHttp, {
        path: "/index.html",
      });

      expect(asset?.storageUrl).toContain("http");
      expect(asset?.etag).toBe(`"${storageId}"`);
      expect(asset?.contentType).toBe("text/html; charset=utf-8");
    });

    test("hides inherited or deleted storage rows from compatibility routes", async () => {
      const t = initConvexTest();
      const storageId = await t.run(async (ctx) => {
        return await ctx.storage.store(new Blob(["legacy"]));
      });
      await t.mutation(internal.lib.recordAsset, {
        path: "/index.html",
        storageId,
        contentType: "text/html; charset=utf-8",
        deploymentId: "deploy-old",
      });
      await t.run(async (ctx) => {
        await ctx.storage.delete(storageId);
      });

      expect(
        await t.query(api.lib.resolveAssetForHttp, { path: "/index.html" }),
      ).toBeNull();
    });

    test("allows compatibility routes to override SPA fallback", async () => {
      const t = initConvexTest();
      await seedIndex(t);

      const asset = await t.query(api.lib.resolveAssetForHttp, {
        path: "/dashboard",
        spaFallback: false,
      });

      expect(asset).toBeNull();
    });
  });
});
