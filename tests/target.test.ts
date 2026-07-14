import { describe, expect, it } from "vitest";
import { resolveReasoningZipSettings } from "../src/settings.js";
import { isLlamaProvider, isLocalUrl, shouldHandleMessage } from "../src/target.js";

describe("target policy", () => {
  it("detects llama providers", () => {
    expect(isLlamaProvider("llama-server=http://127.0.0.1:7484")).toBe(true);
    expect(isLlamaProvider("openai")).toBe(false);
  });

  it("accepts llama provider in llama-only mode", () => {
    const settings = resolveReasoningZipSettings({});
    expect(shouldHandleMessage({ role: "assistant", provider: "llama-server=http://127.0.0.1:7484" }, settings)).toBe(true);
  });

  it("skips OpenAI provider in llama-only mode", () => {
    const settings = resolveReasoningZipSettings({});
    expect(shouldHandleMessage({ role: "assistant", provider: "openai" }, settings)).toBe(false);
  });

  it("disabled skips all", () => {
    const settings = resolveReasoningZipSettings({ enabled: false, mode: "all" });
    expect(shouldHandleMessage({ role: "assistant", provider: "llama-server=x" }, settings)).toBe(false);
  });

  it("local-only skips hosted providers even when compactor endpoint is local", () => {
    const settings = resolveReasoningZipSettings({ mode: "local-only", compactor: { baseUrl: "http://127.0.0.1:7484/v1" } });
    expect(shouldHandleMessage({ role: "assistant", provider: "openai" }, settings)).toBe(false);
  });

  it("local-only accepts local URL providers", () => {
    const settings = resolveReasoningZipSettings({ mode: "local-only" });
    expect(shouldHandleMessage({ role: "assistant", provider: "http://localhost:8080/v1" }, settings)).toBe(true);
  });

  it("local-only accepts local llama-server providers", () => {
    const settings = resolveReasoningZipSettings({ mode: "local-only" });
    expect(shouldHandleMessage({ role: "assistant", provider: "llama-server=http://127.0.0.1:7484" }, settings)).toBe(true);
  });

  it("local-only rejects remote llama-server providers", () => {
    const settings = resolveReasoningZipSettings({ mode: "local-only" });
    expect(shouldHandleMessage({ role: "assistant", provider: "llama-server=https://remote.example/v1" }, settings)).toBe(false);
  });

  it("local-only rejects non-url llama-like provider ids", () => {
    const settings = resolveReasoningZipSettings({ mode: "local-only" });
    expect(shouldHandleMessage({ role: "assistant", provider: "remote-llama.cpp" }, settings)).toBe(false);
  });

  it("recognizes supported local host forms including bracketed IPv6", () => {
    expect(isLocalUrl("http://127.0.0.1:8080/v1")).toBe(true);
    expect(isLocalUrl("http://localhost:8080/v1")).toBe(true);
    expect(isLocalUrl("http://0.0.0.0:8080/v1")).toBe(true);
    expect(isLocalUrl("http://[::1]:8080/v1")).toBe(true);
  });

  it("llama-only continues accepting remote llama-server providers", () => {
    const settings = resolveReasoningZipSettings({ mode: "llama-only" });
    expect(shouldHandleMessage({ role: "assistant", provider: "llama-server=https://remote.example/v1" }, settings)).toBe(true);
  });
});
