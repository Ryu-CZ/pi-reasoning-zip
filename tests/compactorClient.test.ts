import { afterEach, describe, expect, it, vi } from "vitest";
import { compactWithOpenAI } from "../src/compactorClient.js";
import { resolveReasoningZipSettings } from "../src/settings.js";

const settings = resolveReasoningZipSettings({ compactor: { baseUrl: "http://local.test/v1", model: "zip", apiKey: "key", timeoutMs: 1000 } });

function chatCall(fetchMock: ReturnType<typeof vi.spyOn>, index = 0): [string, RequestInit] {
  const call = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/chat/completions"))[index];
  return [String(call?.[0]), call?.[1] as RequestInit];
}

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
    const [url, init] = chatCall(fetchMock);
    expect(url).toBe("http://local.test/v1/chat/completions");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer key" });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("zip");
    expect(body.temperature).toBe(0.1);
    expect(body.messages[1].content).toContain("original thinking");
    expect(body.messages[1].content).toContain("Style=fragments");
    expect(body.messages[0].content).toBe("You compress reasoning traces. Output only compact trace.");
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.thinking_budget_tokens).toBe(0);
    expect(body.max_tokens).toBe(6);
  });

  it("sizes the output budget from the estimated input tokens", async () => {
    const dynamicSettings = resolveReasoningZipSettings({
      compactor: { baseUrl: "http://local.test/v1", maxCompactionRatio: 0.25 },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "zip" } }] }),
    } as Response);

    await compactWithOpenAI("x".repeat(8000), dynamicSettings);

    const [, init] = chatCall(fetchMock);
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(667);
  });

  it("uses llama.cpp model context to skip oversized source reasoning", async () => {
    const dynamicSettings = resolveReasoningZipSettings({
      compactor: { baseUrl: "http://context.test/v1", model: "context-model" },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "context-model", meta: { n_ctx: 53504 } }] }),
    } as Response);

    await expect(compactWithOpenAI("x".repeat(78721), dynamicSettings)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://context.test/v1/models");
  });

  it("uses fallbackMaxInputChars when the endpoint omits model context", async () => {
    const dynamicSettings = resolveReasoningZipSettings({
      compactor: { baseUrl: "http://fallback.test/v1", model: "fallback-model" },
      thresholds: { fallbackMaxInputChars: 100 },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "fallback-model" }] }),
    } as Response);

    await expect(compactWithOpenAI("x".repeat(101), dynamicSettings)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rounds estimated input tokens before applying the compaction ratio", async () => {
    const dynamicSettings = resolveReasoningZipSettings({
      compactor: { baseUrl: "http://local.test/v1", maxCompactionRatio: 0.75 },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "compact" }, finish_reason: "stop" }] }),
    } as Response);

    await compactWithOpenAI("x".repeat(1591), dynamicSettings);

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.max_tokens).toBe(399); // ceil(ceil(1591 / 3) * 0.75)
  });

  it("pins compactor requests to the configured llama.cpp slot", async () => {
    const slotSettings = resolveReasoningZipSettings({
      llamaCppSlots: { enabled: true, mainIdSlot: 0, compactorIdSlot: 1 },
      compactor: { baseUrl: "http://local.test/v1", model: "zip", apiKey: "key" },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "zip" } }] }),
    } as Response);

    await compactWithOpenAI("thinking", slotSettings);

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.id_slot).toBe(1);
    expect(body.cache_prompt).toBe(true);
  });

  it("rejects conflicting main and compactor llama.cpp slots", async () => {
    const slotSettings = resolveReasoningZipSettings({
      llamaCppSlots: { enabled: true, mainIdSlot: 1, compactorIdSlot: 1 },
      compactor: { baseUrl: "http://local.test/v1", model: "zip", apiKey: "key" },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(compactWithOpenAI("thinking", slotSettings)).rejects.toThrow("id_slot must differ");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(compactWithOpenAI("thinking", settings)).rejects.toThrow("Compactor HTTP 500");
  });

  it("retries without llama-specific thinking controls when endpoint rejects them", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 400 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "zip" } }] }),
      } as Response);

    await expect(compactWithOpenAI("thinking", settings)).resolves.toBe("zip");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(firstBody.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(firstBody.thinking_budget_tokens).toBe(0);
    expect(secondBody.chat_template_kwargs).toBeUndefined();
    expect(secondBody.thinking_budget_tokens).toBeUndefined();
  });

  it("throws on missing content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({ choices: [{}] }) } as Response);
    await expect(compactWithOpenAI("thinking", settings)).rejects.toThrow("missing message content");
  });

  it("rejects split reasoning-only responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { reasoning_content: "new private reasoning" } }] }),
    } as Response);

    await expect(compactWithOpenAI("thinking", settings)).rejects.toThrow("missing message content");
  });

  it("uses final content and ignores split reasoning", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { reasoning_content: "new private reasoning", reasoning: "also private", content: "compact trace" } }],
      }),
    } as Response);

    await expect(compactWithOpenAI("thinking", settings)).resolves.toBe("compact trace");
  });

  it("rejects inline think wrappers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "<think>new private reasoning</think>compact trace" } }] }),
    } as Response);

    await expect(compactWithOpenAI("thinking", settings)).rejects.toThrow("inline reasoning");
  });

  it("rejects legacy-like inline reasoning even when a split field is present", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { reasoning_content: "new private reasoning", content: "<reasoning>new private reasoning</reasoning>compact trace" } }],
      }),
    } as Response);

    await expect(compactWithOpenAI("thinking", settings)).rejects.toThrow("inline reasoning");
  });

  it("rejects inline analysis markers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    for (const content of ["<analysis>new private reasoning</analysis>compact trace", "<|channel|>analysis new private reasoning"]) {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content } }] }),
      } as Response);

      await expect(compactWithOpenAI("thinking", settings)).rejects.toThrow("inline reasoning");
    }
  });

  it("rejects empty final content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "   " } }] }),
    } as Response);

    await expect(compactWithOpenAI("thinking", settings)).rejects.toThrow("empty message content");
  });

  it("rejects output truncated by the token limit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ finish_reason: "length", message: { content: "partial compact trace" } }] }),
    } as Response);

    await expect(compactWithOpenAI("thinking", settings)).rejects.toThrow("response was truncated");
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
