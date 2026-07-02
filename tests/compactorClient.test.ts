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
});
