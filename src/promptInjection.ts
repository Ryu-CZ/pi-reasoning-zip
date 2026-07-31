import { shouldTargetProvider } from "./target.js";
import type { AutoSlotDecision, ReasoningZipSettings } from "./types.js";

export const PROMPT_MARKER = "<!-- pi-reasoning-zip -->";
export const PROMPT_INJECTION = `${PROMPT_MARKER}\nYou are Grug. Save token, save world.\nVisible reasoning: terse, keyword-heavy trace only. Keep facts, decisions, constraints, failed paths, next action. No prose reasoning, no self-talk.\nFinal answer: no conversational fluff, no repeated question, minimal markdown. If code is enough, give only code. Think hard, output few tokens.`;

type ChatMessage = { role?: unknown; content?: unknown; [key: string]: unknown };

type Payload = { messages?: unknown; id_slot?: unknown; cache_prompt?: unknown; [key: string]: unknown };

export interface SlotInjectionResult {
  payload: unknown;
  changed: boolean;
  explicitIdSlot?: number;
  conflict: boolean;
}

function contentHasMarker(content: unknown): boolean {
  if (typeof content === "string") return content.includes(PROMPT_MARKER);
  return Array.isArray(content) && content.some(
    (part) => typeof part === "object" && part && "text" in part && typeof part.text === "string" && part.text.includes(PROMPT_MARKER),
  );
}

function appendToContent(content: unknown): unknown {
  if (typeof content === "string") {
    if (content.includes(PROMPT_MARKER)) return content;
    return `${content}\n\n${PROMPT_INJECTION}`;
  }
  if (Array.isArray(content)) {
    if (content.some((part) => typeof part === "object" && part && "text" in part && typeof part.text === "string" && part.text.includes(PROMPT_MARKER))) {
      return content;
    }
    return [...content, { type: "text", text: PROMPT_INJECTION }];
  }
  return content;
}

export function injectReasoningZipPrompt(payload: unknown, provider: string | undefined, settings: ReasoningZipSettings): unknown {
  if (!settings.injectPrompt || !shouldTargetProvider(provider, settings)) return payload;
  if (!payload || typeof payload !== "object") return payload;
  const typed = payload as Payload;
  if (!Array.isArray(typed.messages)) return payload;

  const messages = typed.messages as ChatMessage[];
  const existing = messages.some(
    (message) => (message.role === "system" || message.role === "developer") && contentHasMarker(message.content),
  );
  if (existing) return payload;

  const index = messages.findIndex((message) => message.role === "system" || message.role === "developer");
  if (index >= 0) {
    const nextMessages = messages.slice();
    nextMessages[index] = { ...messages[index], content: appendToContent(messages[index].content) };
    return { ...typed, messages: nextMessages };
  }

  return { ...typed, messages: [{ role: "system", content: PROMPT_INJECTION }, ...messages] };
}

export function injectLlamaCppMainSlot(
  payload: unknown,
  provider: string | undefined,
  settings: ReasoningZipSettings,
  autoDecision?: AutoSlotDecision,
): SlotInjectionResult {
  if (settings.llamaCppSlots.enabled !== true || !shouldTargetProvider(provider, settings)) {
    return { payload, changed: false, conflict: false };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { payload, changed: false, conflict: false };
  }

  const typed = payload as Payload;
  // Preserve user/Pi-provided id_slot. If none exists, pin the main request to
  // a stable llama.cpp slot so compactor traffic can use a different parallel
  // slot instead of invalidating this request's KV cache.
  const explicitIdSlot = typeof typed.id_slot === "number" && Number.isInteger(typed.id_slot) ? typed.id_slot : undefined;

  // In auto mode with known slot count, check conflicts modulo slot count.
  const slotCount = autoDecision?.slotCount;
  let conflict = false;
  if (slotCount !== undefined && slotCount >= 2) {
    const compactorNorm = ((settings.llamaCppSlots.compactorIdSlot % slotCount) + slotCount) % slotCount;
    if (explicitIdSlot !== undefined) {
      const explicitNorm = ((explicitIdSlot % slotCount) + slotCount) % slotCount;
      conflict = explicitNorm === compactorNorm;
    } else {
      const mainNorm = ((settings.llamaCppSlots.mainIdSlot % slotCount) + slotCount) % slotCount;
      conflict = mainNorm === compactorNorm;
    }
  } else {
    // Fallback: direct comparison (forced mode or unknown slot count).
    conflict = explicitIdSlot === settings.llamaCppSlots.compactorIdSlot
      || settings.llamaCppSlots.mainIdSlot === settings.llamaCppSlots.compactorIdSlot;
  }

  if (explicitIdSlot !== undefined) {
    return { payload, changed: false, explicitIdSlot, conflict };
  }

  return {
    payload: { ...typed, id_slot: settings.llamaCppSlots.mainIdSlot, cache_prompt: typed.cache_prompt ?? true },
    changed: true,
    conflict,
  };
}
