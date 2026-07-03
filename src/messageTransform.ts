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
    typeof block.thinkingSignature === "string" ||
    typeof block.encrypted_content === "string" ||
    Array.isArray(block.reasoning_details) ||
    block.redacted === true
  );
}

function acceptableCompaction(original: string, compacted: string, settings: ReasoningZipSettings): string | undefined {
  const text = compacted.trim();
  if (!text || text === "none") return undefined;
  if (text.length >= original.length) return undefined;
  if (text.length / original.length > settings.thresholds.targetRatio) return undefined;
  if (text.length > settings.thresholds.maxTraceChars) return undefined;
  return text;
}

export async function compactAssistantMessage(
  message: PiMessage,
  settings: ReasoningZipSettings,
  compactText: CompactText,
): Promise<{ message: PiMessage; changed: boolean }> {
  if (!shouldHandleMessage(message, settings)) return { message, changed: false };
  if (!Array.isArray(message.content)) return { message, changed: false };

  let changed = false;
  const nextContent: PiMessageBlock[] = [];

  for (const block of message.content) {
    if (!isThinkingBlock(block) || hasOpaqueReasoningMetadata(block) || block.thinking.length < settings.thresholds.minChars) {
      nextContent.push(block);
      continue;
    }

    try {
      const compacted = acceptableCompaction(block.thinking, await compactText(block.thinking), settings);
      if (!compacted) {
        nextContent.push(block);
        continue;
      }
      nextContent.push({ ...block, thinking: compacted });
      changed = true;
    } catch {
      nextContent.push(block);
    }
  }

  if (!changed) return { message, changed: false };
  return { message: { ...message, content: nextContent }, changed: true };
}
