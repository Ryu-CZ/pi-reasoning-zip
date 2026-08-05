import { shouldTargetProvider } from "./target.js";
import type { AutoSlotDecision, ReasoningZipSettings } from "./types.js";

type Payload = { id_slot?: unknown; cache_prompt?: unknown; [key: string]: unknown };

export interface SlotInjectionResult {
  payload: unknown;
  changed: boolean;
  explicitIdSlot?: number;
  conflict: boolean;
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
