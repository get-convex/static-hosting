import { describe, expect, test } from "vitest";
import {
  buildDeployUploadArgs,
  parseDeployArgs,
  parseUploadArgs,
} from "./args.js";

describe("CLI argument parsing", () => {
  test("parses and forwards deploy upload options exactly", () => {
    const parsed = parseDeployArgs([
      "--dist",
      "web-dist",
      "--component",
      "site",
      "--cdn",
      "--cdn-delete-function",
      "staticHosting:deleteCdnBlobs",
      "--no-spa",
    ]);

    expect(buildDeployUploadArgs(parsed)).toEqual([
      "upload",
      "--dist",
      "web-dist",
      "--component",
      "site",
      "--prod",
      "--cdn",
      "--cdn-delete-function",
      "staticHosting:deleteCdnBlobs",
      "--no-spa",
    ]);
  });

  test("parses upload environment and concurrency options", () => {
    expect(
      parseUploadArgs([
        "--prod",
        "--component",
        "site",
        "--concurrency",
        "8",
        "--build-command",
        "npm run build:web",
      ]),
    ).toMatchObject({
      prod: true,
      component: "site",
      concurrency: 8,
      build: true,
      buildCommand: "npm run build:web",
    });
  });

  test.each([
    ["upload", () => parseUploadArgs(["--dist", "--prod"])],
    ["deploy", () => parseDeployArgs(["--cdn-delete-function", "--no-spa"])],
    ["unknown upload", () => parseUploadArgs(["--wat"])],
    ["unknown deploy", () => parseDeployArgs(["--wat"])],
  ])("rejects malformed %s arguments", (_name, parse) => {
    expect(parse).toThrow();
  });
});
