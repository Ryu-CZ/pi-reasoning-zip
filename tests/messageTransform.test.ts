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

  it("preserves text and tool blocks", async () => {
    const result = await compactAssistantMessage(
      { role: "assistant", content: [{ type: "text", text: "hello" }, { type: "tool_use", id: "1" }, { type: "thinking", thinking: "abcdef" }] },
      settings,
      async () => "zip",
    );
    expect(result.message.content).toMatchObject([{ type: "text", text: "hello" }, { type: "tool_use", id: "1" }, { type: "thinking", thinking: "zip" }]);
  });

  it("keeps multiple thinking block order", async () => {
    const result = await compactAssistantMessage(
      { role: "assistant", content: [{ type: "thinking", thinking: "abcdef" }, { type: "text", text: "between" }, { type: "thinking", thinking: "ghijkl" }] },
      settings,
      async (text) => (text.startsWith("abc") ? "one" : "two"),
    );
    expect(result.message.content).toMatchObject([{ thinking: "one" }, { text: "between" }, { thinking: "two" }]);
  });

  it("compactor failure returns original block", async () => {
    const message = { role: "assistant", content: [{ type: "thinking", thinking: "abcdef" }] };
    const result = await compactAssistantMessage(message, settings, async () => { throw new Error("down"); });
    expect(result.changed).toBe(false);
    expect(result.message).toBe(message);
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

  it("skips signed/encrypted/opaque thinking metadata", async () => {
    for (const metadata of [{ signature: "sig" }, { reasoning_signature: "sig" }, { encrypted_content: "opaque" }, { reasoning_details: [] }]) {
      const message = { role: "assistant", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz", ...metadata }] };
      const result = await compactAssistantMessage(message, settings, async () => "zip");
      expect(result.changed).toBe(false);
    }
  });
});
