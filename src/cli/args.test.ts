import { describe, expect, test } from "vitest";
import {
  buildDeployUploadArgs,
  parseDeployArgs,
  parseUploadArgs,
} from "./args.js";

describe("CLI argument parsing", () => {
  test("targets named preview uploads without selecting production", () => {
    expect(parseUploadArgs([])).toMatchObject({
      prod: false,
      previewName: null,
    });
    expect(
      parseUploadArgs(["--preview-name", "feature-routing"]),
    ).toMatchObject({
      prod: false,
      previewName: "feature-routing",
    });
  });

  test.each([
    ["--prod", "--preview-name", "feature-routing"],
    ["--preview-name", "feature-routing", "--prod"],
  ])("rejects conflicting upload destinations: %s", (...args) => {
    expect(() => parseUploadArgs(args)).toThrow(
      "--prod and --preview-name cannot be combined",
    );
  });

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
    ["missing preview name", () => parseUploadArgs(["--preview-name"])],
    [
      "invalid preview name",
      () => parseUploadArgs(["--preview-name", "--prod"]),
    ],
    ["upload", () => parseUploadArgs(["--dist", "--prod"])],
    ["deploy", () => parseDeployArgs(["--cdn-delete-function", "--no-spa"])],
    ["unknown upload", () => parseUploadArgs(["--wat"])],
    ["unknown deploy", () => parseDeployArgs(["--wat"])],
  ])("rejects malformed %s arguments", (_name, parse) => {
    expect(parse).toThrow();
  });
});
