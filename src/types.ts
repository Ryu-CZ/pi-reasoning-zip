/**
 * Provider targeting policy. `local-only` is the safe default; `llama-only`
 * accepts any llama.cpp-like provider, and `all` permits every provider.
 */
export type ReasoningZipMode = "llama-only" | "local-only" | "all";

/**
 * llama.cpp slot isolation policy. `false` is the compatible default, `auto`
 * probes and validates `/slots`, and `true` trusts the configured topology.
 */
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

/** Fully resolved runtime settings, including built-in defaults for omitted or invalid values. */
export interface ReasoningZipSettings {
  /** Master extension switch. Default: `true`; `false` also disables slot handling and the footer. */
  enabled: boolean;
  /** Limits which providers may send plain reasoning to the compactor. Default: `local-only`. */
  mode: ReasoningZipMode;
  /** Non-empty, global-only Pi footer reminder shown while enabled. Default: `🗜️ Zip`. */
  footerStatus: string;
  llamaCppSlots: {
    /** Controls optional main/compactor KV-cache isolation. Default: `false` (no probing or pinning). */
    enabled: ReasoningZipSlotMode;
    /** Non-negative `id_slot` for targeted main Pi requests while pinning is active. Default: `0`. */
    mainIdSlot: number;
    /** Non-negative `id_slot` for compactor requests; must not resolve to the main slot. Default: `1`. */
    compactorIdSlot: number;
  };
  compactor: {
    /** Non-empty OpenAI-compatible API root; trailing slashes are removed. Default: local port 7484 `/v1`. */
    baseUrl: string;
    /** Non-empty model name or alias sent to the compactor endpoint. Default: `unsloth`. */
    model: string;
    /** Non-empty bearer token for compaction and slot probes. Default placeholder suits unauthenticated local servers only. */
    apiKey: string;
    /** Output-token budget as a `(0, 1]` fraction of estimated source tokens. Default: `1`. */
    maxCompactionRatio: number;
    /** Non-negative sampling temperature sent unchanged to the endpoint. Default: `0.1`. */
    temperature: number;
    /** Milliseconds covering the request and compatibility retry; must be at least `1`. Default: `30000`. */
    timeoutMs: number;
  };
  thresholds: {
    /** Minimum source length in UTF-16 code units eligible for compaction. Default: `1000`. */
    minChars: number;
    /** Source-size limit used only without context metadata; must be at least `1`. Default: `50000`. */
    fallbackMaxInputChars: number;
    /** Accepted-output cap in UTF-16 code units; valid values are `-1` or at least `1`. Default: `-1` (disabled). */
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
