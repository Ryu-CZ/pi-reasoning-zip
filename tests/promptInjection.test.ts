import { describe, expect, it } from "vitest";
import { injectReasoningZipPrompt, PROMPT_INJECTION, PROMPT_MARKER } from "../src/promptInjection.js";
import { resolveReasoningZipSettings } from "../src/settings.js";

const settings = resolveReasoningZipSettings({ mode: "llama-only" });
const provider = "llama-server=http://127.0.0.1:7484";

describe("injectReasoningZipPrompt", () => {
  it("injects into system message", () => {
    const payload = { messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }] };
    const result = injectReasoningZipPrompt(payload, provider, settings) as any;
    expect(result.messages[0].content).toContain(PROMPT_MARKER);
    expect(result.messages[0].content).toContain("You are Grug");
    expect(result.messages[0].content).toContain("Visible reasoning: terse, keyword-heavy trace only");
    expect(result.messages[0].content).toContain("Think hard, output few tokens");
  });

  it("injects into developer message", () => {
    const payload = { messages: [{ role: "developer", content: "dev" }] };
    const result = injectReasoningZipPrompt(payload, provider, settings) as any;
    expect(result.messages[0].content).toContain(PROMPT_MARKER);
  });

  it("does not duplicate marker", () => {
    const payload = { messages: [{ role: "system", content: `sys\n${PROMPT_MARKER}` }] };
    const result = injectReasoningZipPrompt(payload, provider, settings);
    expect(result).toBe(payload);
  });

  it("skips non-target provider", () => {
    const payload = { messages: [{ role: "system", content: "sys" }] };
    const result = injectReasoningZipPrompt(payload, "openai", settings);
    expect(result).toBe(payload);
  });

  it("unknown payload unchanged", () => {
    const payload = { prompt: "hi" };
    expect(injectReasoningZipPrompt(payload, provider, settings)).toBe(payload);
  });

  it("prepends system message if none exists", () => {
    const payload = { messages: [{ role: "user", content: "hi" }] };
    const result = injectReasoningZipPrompt(payload, provider, settings) as any;
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[0].content).toBe(PROMPT_INJECTION);
  });
});
