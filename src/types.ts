export type ReasoningZipMode = "llama-only" | "local-only" | "all";
export type ReasoningZipSlotMode = boolean | "auto";

/** Result of checking whether main and compactor requests can use isolated slots. */
export interface AutoSlotDecision {
  /** Whether pinning was enabled based on probe. */
  pinning: boolean;
  /** Actual slot count from probe, or undefined if probe failed. */
  slotCount?: number;
  /** Whether we should skip the compactor (unsafe shared-server). */
  skipCompactor: boolean;
}

export interface ReasoningZipSettings {
  enabled: boolean;
  mode: ReasoningZipMode;
  footerStatus: string;
  llamaCppSlots: {
    enabled: ReasoningZipSlotMode;
    mainIdSlot: number;
    compactorIdSlot: number;
  };
  compactor: {
    baseUrl: string;
    model: string;
    apiKey: string;
    maxCompactionRatio: number;
    temperature: number;
    timeoutMs: number;
  };
  thresholds: {
    minChars: number;
    fallbackMaxInputChars: number;
    maxTraceChars: number;
  };
}

export interface PiMessageBlock {
  type?: string;
  text?: string;
  thinking?: string;
  [key: string]: unknown;
}

export interface PiMessage {
  role?: string;
  content?: string | PiMessageBlock[];
  provider?: string;
  model?: string;
  api?: string;
  [key: string]: unknown;
}
