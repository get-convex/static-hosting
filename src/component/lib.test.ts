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

    const urls = await t.mutation(internal.lib.generateUploadUrls, { count: 3 });
    expect(urls).toHaveLength(3);
    for (const u of urls) {
      expect(typeof u).toBe("string");
    }
  });

  test("getByPath returns null when absent", async () => {
    const t = initConvexTest();
    const asset = await t.query(internal.lib.getByPath, { path: "/index.html" });
    expect(asset).toBeNull();
  });

  test("listAssets is empty by default", async () => {
    const t = initConvexTest();
    const assets = await t.query(internal.lib.listAssets, {});
    expect(assets).toHaveLength(0);
  });

  test("gcOldAssets on empty db returns zero", async () => {
    const t = initConvexTest();
    const result = await t.mutation(internal.lib.gcOldAssets, {
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

  test("gcOldAssets returns blobIds for old CDN assets and bumps deployment", async () => {
    const t = initConvexTest();

    await t.mutation(internal.lib.recordAsset, {
      path: "/assets/main.js",
      blobId: "blob-abc",
      contentType: "application/javascript; charset=utf-8",
      deploymentId: "deploy-old",
    });

    const result = await t.mutation(internal.lib.gcOldAssets, {
      currentDeploymentId: "deploy-new",
    });
    expect(result.deleted).toBe(0);
    expect(result.blobIds).toEqual(["blob-abc"]);

    const deployment = await t.query(api.lib.getCurrentDeployment, {});
    expect(deployment?.currentDeploymentId).toBe("deploy-new");
  });

  test("recordAssets batches multiple inserts", async () => {
    const t = initConvexTest();

    await t.mutation(internal.lib.recordAssets, {
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

    const all = await t.query(internal.lib.listAssets, {});
    expect(all).toHaveLength(2);
  });
});
