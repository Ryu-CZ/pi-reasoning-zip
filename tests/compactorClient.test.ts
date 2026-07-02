import { afterEach, describe, expect, it, vi } from "vitest";
import { compactWithOpenAI } from "../src/compactorClient.js";
import { resolveReasoningZipSettings } from "../src/settings.js";

const settings = resolveReasoningZipSettings({ compactor: { baseUrl: "http://local.test/v1", model: "zip", apiKey: "key", timeoutMs: 1000 } });

describe("compactWithOpenAI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends expected payload and extracts message content", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: " facts:\n- a " } }] }),
    } as Response);

    await expect(compactWithOpenAI("original thinking", settings)).resolves.toBe("facts:\n- a");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://local.test/v1/chat/completions");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("zip");
    expect(body.messages[1].content).toContain("original thinking");
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("throws on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(compactWithOpenAI("thinking", settings)).rejects.toThrow("Compactor HTTP 500");
  });

  it("throws on missing content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({ choices: [{}] }) } as Response);
    await expect(compactWithOpenAI("thinking", settings)).rejects.toThrow("missing message content");
  });

  it("passes an abort signal for timeout handling", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "zip" } }] }),
    } as Response);
    await compactWithOpenAI("thinking", settings);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects when compactor request times out", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const signal = (init as RequestInit)?.signal;
      return new Promise((_, reject) => {
        if (signal?.aborted) reject(new DOMException("The operation was aborted.", "AbortError"));
        signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    const promise = compactWithOpenAI("thinking", settings); // timeoutMs = 1000

    // Attach rejection handler before advancing timers so no unhandled rejection
    const assertion = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;

    vi.useRealTimers();
  });
});
