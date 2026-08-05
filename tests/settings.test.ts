import { describe, expect, it } from "vitest";
import { resolveReasoningZipSettings } from "../src/settings.js";

describe("resolveReasoningZipSettings", () => {
  it("returns defaults for empty config", () => {
    const settings = resolveReasoningZipSettings(undefined);
    expect(settings.mode).toBe("local-only");
    expect(settings.storageMode).toBe("compact-new");
    expect(settings.compressionRole).toBe("grug");
    expect(settings.compactor.baseUrl).toBe("http://127.0.0.1:7484/v1");
    expect(settings.compactor.maxCompactionRatio).toBe(0.25);
    expect(settings.llamaCppSlots).toEqual({ enabled: false, mainIdSlot: 0, compactorIdSlot: 1 });
    expect(settings.thresholds.maxInputChars).toBe(50000);
    expect(settings.footerStatus).toBe("🗜️ Zip");
  });

  it("merges partial config", () => {
    const settings = resolveReasoningZipSettings({ mode: "all", compressionRole: "ultra-grug", footerStatus: "Zip On", llamaCppSlots: { enabled: true, mainIdSlot: 2, compactorIdSlot: 3 }, compactor: { model: "zipper" }, thresholds: { minChars: 10, maxInputChars: 20000 } });
    expect(settings.mode).toBe("all");
    expect(settings.compressionRole).toBe("ultra-grug");
    expect(settings.compactor.model).toBe("zipper");
    expect(settings.llamaCppSlots).toEqual({ enabled: true, mainIdSlot: 2, compactorIdSlot: 3 });
    expect(settings.thresholds.minChars).toBe(10);
    expect(settings.thresholds.maxInputChars).toBe(20000);
    expect(settings.footerStatus).toBe("Zip On");
  });

  it("accepts auto slot mode and falls back for invalid enums", () => {
    const autoSettings = resolveReasoningZipSettings({ llamaCppSlots: { enabled: "auto" } });
    expect(autoSettings.llamaCppSlots.enabled).toBe("auto");

    const settings = resolveReasoningZipSettings({ mode: "bad", storageMode: "rewrite-all", compressionRole: "word-soup", llamaCppSlots: { enabled: "bad" } });
    expect(settings.mode).toBe("local-only");
    expect(settings.storageMode).toBe("compact-new");
    expect(settings.compressionRole).toBe("grug");
    expect(settings.llamaCppSlots.enabled).toBe(false);
  });

  it("removes all trailing slashes from the compactor base URL", () => {
    const settings = resolveReasoningZipSettings({ compactor: { baseUrl: "http://local.test/v1///" } });
    expect(settings.compactor.baseUrl).toBe("http://local.test/v1");
  });

  it("accepts a maximum compaction ratio and falls back for invalid fractions", () => {
    expect(resolveReasoningZipSettings({ compactor: { maxCompactionRatio: 0.5 } }).compactor.maxCompactionRatio).toBe(0.5);

    expect(resolveReasoningZipSettings({ compactor: { maxCompactionRatio: 0 } }).compactor.maxCompactionRatio).toBe(0.25);
    expect(resolveReasoningZipSettings({ compactor: { maxCompactionRatio: 1.1 } }).compactor.maxCompactionRatio).toBe(0.25);
  });
});
