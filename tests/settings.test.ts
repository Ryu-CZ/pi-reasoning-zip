import { describe, expect, it } from "vitest";
import { resolveReasoningZipSettings } from "../src/settings.js";

describe("resolveReasoningZipSettings", () => {
  it("returns defaults for empty config", () => {
    const settings = resolveReasoningZipSettings(undefined);
    expect(settings.mode).toBe("llama-only");
    expect(settings.storageMode).toBe("compact-new");
    expect(settings.compactor.baseUrl).toBe("http://127.0.0.1:7484/v1");
  });

  it("merges partial config", () => {
    const settings = resolveReasoningZipSettings({ mode: "all", compactor: { model: "zipper" }, thresholds: { minChars: 10 } });
    expect(settings.mode).toBe("all");
    expect(settings.compactor.model).toBe("zipper");
    expect(settings.thresholds.minChars).toBe(10);
    expect(settings.injectPrompt).toBe(true);
  });

  it("falls back for invalid enums", () => {
    const settings = resolveReasoningZipSettings({ mode: "bad", storageMode: "rewrite-all" });
    expect(settings.mode).toBe("llama-only");
    expect(settings.storageMode).toBe("compact-new");
  });
});
