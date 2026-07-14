import { describe, expect, it } from "vitest";
import { compactAssistantMessage } from "../src/messageTransform.js";
import { resolveReasoningZipSettings } from "../src/settings.js";

const settings = resolveReasoningZipSettings({ thresholds: { minChars: 5, maxTraceChars: 100 }, mode: "all" });

describe("compactAssistantMessage", () => {
  it("compacts long thinking", async () => {
    const result = await compactAssistantMessage(
      { role: "assistant", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] },
      settings,
      async () => "facts:\n- kept",
    );
    expect(result.changed).toBe(true);
    expect(result.failures).toBe(0);
    expect((result.message.content as any[])[0].thinking).toBe("facts:\n- kept");
  });

  it("skips short thinking", async () => {
    const message = { role: "assistant", content: [{ type: "thinking", thinking: "abc" }] };
    const result = await compactAssistantMessage(message, settings, async () => "x");
    expect(result.changed).toBe(false);
    expect(result.message).toBe(message);
  });

  it("leaves messages with no thinking unchanged", async () => {
    const message = { role: "assistant", content: [{ type: "text", text: "hello" }] };
    const result = await compactAssistantMessage(message, settings, async () => "x");
    expect(result.changed).toBe(false);
  });

  it("preserves tool-call messages without compacting their reasoning", async () => {
    let called = false;
    const result = await compactAssistantMessage(
      { role: "assistant", content: [{ type: "text", text: "hello" }, { type: "toolCall", id: "1", name: "read", arguments: {} }, { type: "thinking", thinking: "abcdef" }] },
      settings,
      async () => { called = true; return "zip"; },
    );
    expect(result.changed).toBe(false);
    expect(called).toBe(false);
    expect(result.message.content).toMatchObject([{ type: "text", text: "hello" }, { type: "toolCall", id: "1" }, { type: "thinking", thinking: "abcdef" }]);
  });

  it("keeps multiple thinking block order", async () => {
    const result = await compactAssistantMessage(
      { role: "assistant", content: [{ type: "thinking", thinking: "abcdef" }, { type: "text", text: "between" }, { type: "thinking", thinking: "ghijkl" }] },
      settings,
      async (text) => (text.startsWith("abc") ? "one" : "two"),
    );
    expect(result.message.content).toMatchObject([{ thinking: "one" }, { text: "between" }, { thinking: "two" }]);
  });

  it("starts independent thinking block compactions concurrently", async () => {
    const starts: string[] = [];
    let resolveFirst: (value: string) => void = () => { throw new Error("first compaction was not started"); };
    let resolveSecond: (value: string) => void = () => { throw new Error("second compaction was not started"); };
    const pending = compactAssistantMessage(
      { role: "assistant", content: [{ type: "thinking", thinking: "abcdef" }, { type: "thinking", thinking: "ghijkl" }] },
      settings,
      (text) => {
        starts.push(text);
        return new Promise<string>((resolve) => {
          if (text.startsWith("abc")) resolveFirst = resolve;
          else resolveSecond = resolve;
        });
      },
    );

    await Promise.resolve();

    expect(starts).toEqual(["abcdef", "ghijkl"]);
    resolveSecond("two");
    resolveFirst("one");
    const result = await pending;
    expect(result.message.content).toMatchObject([{ thinking: "one" }, { thinking: "two" }]);
  });

  it("compactor failure returns original block", async () => {
    const message = { role: "assistant", content: [{ type: "thinking", thinking: "abcdef" }] };
    const result = await compactAssistantMessage(message, settings, async () => { throw new Error("down"); });
    expect(result.changed).toBe(false);
    expect(result.message).toBe(message);
    expect(result.failures).toBe(1);
  });

  it("rejects longer compact output", async () => {
    const message = { role: "assistant", content: [{ type: "thinking", thinking: "abcdef" }] };
    const result = await compactAssistantMessage(message, settings, async () => "this is much longer");
    expect(result.changed).toBe(false);
  });

  it("skips user, tool, and custom messages", async () => {
    for (const role of ["user", "tool", undefined]) {
      const message = { role, content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] };
      const result = await compactAssistantMessage(message, settings, async () => "zip");
      expect(result.changed).toBe(false);
      expect(result.message).toBe(message);
    }
  });

  it("unknown provider is skipped by default", async () => {
    const defaultSettings = resolveReasoningZipSettings({ thresholds: { minChars: 5 } });
    const message = { role: "assistant", provider: "openai", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] };
    const result = await compactAssistantMessage(message, defaultSettings, async () => "zip");
    expect(result.changed).toBe(false);
  });

  it("storage off and disabled mode skip compaction", async () => {
    for (const offSettings of [resolveReasoningZipSettings({ mode: "all", storageMode: "off" }), resolveReasoningZipSettings({ mode: "disabled" })]) {
      const message = { role: "assistant", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] };
      const result = await compactAssistantMessage(message, offSettings, async () => "zip");
      expect(result.changed).toBe(false);
    }
  });

  it("leaves string content unchanged", async () => {
    const message = { role: "assistant", content: "plain text" };
    const result = await compactAssistantMessage(message, settings, async () => "zip");
    expect(result.changed).toBe(false);
    expect(result.message).toBe(message);
  });

  it("rejects none, empty, and over-limit outputs", async () => {
    for (const output of ["none", "   ", "x".repeat(101)]) {
      const message = { role: "assistant", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] };
      const result = await compactAssistantMessage(message, settings, async () => output);
      expect(result.changed).toBe(false);
    }
  });

  it("skips thinking over the configured compactor input limit", async () => {
    const limited = resolveReasoningZipSettings({ mode: "all", thresholds: { minChars: 5, maxInputChars: 10 } });
    let called = false;
    const message = { role: "assistant", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] };
    const result = await compactAssistantMessage(message, limited, async () => { called = true; return "zip"; });
    expect(result.changed).toBe(false);
    expect(called).toBe(false);
  });

  it("compacts llama.cpp reasoning_content blocks", async () => {
    const result = await compactAssistantMessage(
      { role: "assistant", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz", thinkingSignature: "reasoning_content" }] },
      settings,
      async () => "zip",
    );
    expect(result.changed).toBe(true);
    expect((result.message.content as any[])[0]).toMatchObject({ thinking: "zip", thinkingSignature: "reasoning_content" });
  });

  it("skips signed/encrypted/opaque thinking metadata", async () => {
    for (const metadata of [
      { signature: "sig" },
      { reasoning_signature: "sig" },
      { thinkingSignature: "sig" },
      { thinkingSignature: "" },
      { encrypted_content: "opaque" },
      { reasoning_details: [] },
      { redacted: true },
    ]) {
      const message = { role: "assistant", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz", ...metadata }] };
      const result = await compactAssistantMessage(message, settings, async () => "zip");
      expect(result.changed).toBe(false);
    }
  });
});
