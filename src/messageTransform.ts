import type { PiMessage, PiMessageBlock, ReasoningZipSettings } from "./types.js";
import { shouldHandleMessage } from "./target.js";

export type CompactText = (thinking: string) => Promise<string>;

function isThinkingBlock(block: PiMessageBlock): block is PiMessageBlock & { thinking: string } {
  return block.type === "thinking" && typeof block.thinking === "string";
}

function hasOpaqueReasoningMetadata(block: PiMessageBlock): boolean {
  return (
    typeof block.signature === "string" ||
    typeof block.reasoning_signature === "string" ||
    // Pi uses this value as the OpenAI-compatible field name for plain
    // llama.cpp reasoning, not as an opaque provider signature.
    (typeof block.thinkingSignature === "string" && block.thinkingSignature !== "reasoning_content") ||
    typeof block.encrypted_content === "string" ||
    Array.isArray(block.reasoning_details) ||
    block.redacted === true
  );
}

function acceptableCompaction(original: string, compacted: string, settings: ReasoningZipSettings): string | undefined {
  const text = compacted.trim();
  if (!text || text === "none") return undefined;
  if (text.length >= original.length) return undefined;
  if (text.length > settings.thresholds.maxTraceChars) return undefined;
  return text;
}

export async function compactAssistantMessage(
  message: PiMessage,
  settings: ReasoningZipSettings,
  compactText: CompactText,
): Promise<{ message: PiMessage; changed: boolean; failures: number }> {
  if (!shouldHandleMessage(message, settings)) return { message, changed: false, failures: 0 };
  if (!Array.isArray(message.content)) return { message, changed: false, failures: 0 };
  // Tool-call continuations may depend on the exact preceding reasoning. Until
  // that flow is verified end-to-end, preserve the complete assistant message.
  if (message.content.some((block) => block.type === "toolCall")) return { message, changed: false, failures: 0 };

  const results = await Promise.all(message.content.map(async (block): Promise<{ block: PiMessageBlock; changed: boolean; failures: number }> => {
    if (
      !isThinkingBlock(block)
      || hasOpaqueReasoningMetadata(block)
      || block.thinking.length < settings.thresholds.minChars
      || block.thinking.length > settings.thresholds.maxInputChars
    ) {
      return { block, changed: false, failures: 0 };
    }

    try {
      const compacted = acceptableCompaction(block.thinking, await compactText(block.thinking), settings);
      if (!compacted) {
        return { block, changed: false, failures: 0 };
      }
      return { block: { ...block, thinking: compacted }, changed: true, failures: 0 };
    } catch {
      return { block, changed: false, failures: 1 };
    }
  }));

  const changed = results.some((result) => result.changed);
  const failures = results.reduce((count, result) => count + result.failures, 0);
  if (!changed) return { message, changed: false, failures };
  return { message: { ...message, content: results.map((result) => result.block) }, changed: true, failures };
}
