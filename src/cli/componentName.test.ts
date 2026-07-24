import { describe, expect, test } from "vitest";
import {
  componentNameCandidates,
  DEFAULT_COMPONENT_NAME,
  LEGACY_COMPONENT_NAME,
  legacyComponentNameWarning,
} from "./componentName.js";

describe("component name resolution", () => {
  test("default name also probes the legacy name", () => {
    expect(componentNameCandidates(DEFAULT_COMPONENT_NAME)).toEqual([
      DEFAULT_COMPONENT_NAME,
      LEGACY_COMPONENT_NAME,
    ]);
  });

  test("legacy name is used verbatim without expanding", () => {
    expect(componentNameCandidates(LEGACY_COMPONENT_NAME)).toEqual([
      LEGACY_COMPONENT_NAME,
    ]);
  });

  test("a custom name is never redirected to another instance", () => {
    expect(componentNameCandidates("staticHostingV2")).toEqual([
      "staticHostingV2",
    ]);
  });

  test("the legacy warning names the instance and the current default", () => {
    const warning = legacyComponentNameWarning(LEGACY_COMPONENT_NAME);
    expect(warning).toContain(LEGACY_COMPONENT_NAME);
    expect(warning).toContain(DEFAULT_COMPONENT_NAME);
  });
});
