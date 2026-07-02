import { describe, expect, it } from "vitest";
import { buildCompactionPrompt } from "../src/compactPrompt.js";

describe("buildCompactionPrompt", () => {
  it("includes reasoning text and required format", () => {
    const prompt = buildCompactionPrompt("exact/path.ts and command npm test");
    expect(prompt).toContain("exact/path.ts and command npm test");
    expect(prompt).toContain("facts, decisions, constraints, failed, next");
    expect(prompt).toContain("output exactly: none");
  });
});
