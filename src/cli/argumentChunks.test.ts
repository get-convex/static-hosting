import { describe, expect, test } from "vitest";
import {
  chunkBySerializedArgument,
  MAX_CONVEX_ARGUMENT_BYTES,
} from "./argumentChunks.js";

describe("chunkBySerializedArgument", () => {
  test("keeps every serialized command argument within the portable limit", () => {
    const records = Array.from({ length: 200 }, (_, index) => ({
      path: `/assets/${index}-${"x".repeat(180)}.js`,
      deploymentId: "deployment",
    }));

    const chunks = chunkBySerializedArgument(records, (assets) => ({ assets }));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(records);
    for (const assets of chunks) {
      expect(Buffer.byteLength(JSON.stringify({ assets }))).toBeLessThanOrEqual(
        MAX_CONVEX_ARGUMENT_BYTES,
      );
    }
  });

  test("rejects one record that cannot fit safely", () => {
    expect(() =>
      chunkBySerializedArgument(
        ["x".repeat(200)],
        (values) => ({ values }),
        100,
      ),
    ).toThrow("Shorten the asset path");
  });
});
