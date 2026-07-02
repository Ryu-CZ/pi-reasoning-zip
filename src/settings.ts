import type { ReasoningZipMode, ReasoningZipSettings, ReasoningZipStorageMode } from "./types.js";

export const DEFAULT_SETTINGS: ReasoningZipSettings = {
  enabled: true,
  mode: "llama-only",
  storageMode: "compact-new",
  injectPrompt: true,
  compactor: {
    baseUrl: "http://127.0.0.1:7484/v1",
    model: "unsloth",
    apiKey: "sk-placeholder",
    maxTokens: 512,
    temperature: 0.1,
    timeoutMs: 30000,
  },
  thresholds: {
    minChars: 1000,
    targetRatio: 0.15,
    maxTraceChars: 2000,
  },
};

const modes = new Set<ReasoningZipMode>(["llama-only", "local-only", "all", "disabled"]);
const storageModes = new Set<ReasoningZipStorageMode>(["compact-new", "off"]);

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback: number, min = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min ? value : fallback;
}

export function resolveReasoningZipSettings(input: unknown): ReasoningZipSettings {
  const root = asObject(input);
  const compactor = asObject(root.compactor);
  const thresholds = asObject(root.thresholds);

  const mode = modes.has(root.mode as ReasoningZipMode) ? (root.mode as ReasoningZipMode) : DEFAULT_SETTINGS.mode;
  const storageMode = storageModes.has(root.storageMode as ReasoningZipStorageMode)
    ? (root.storageMode as ReasoningZipStorageMode)
    : DEFAULT_SETTINGS.storageMode;

  return {
    enabled: booleanValue(root.enabled, DEFAULT_SETTINGS.enabled),
    mode,
    storageMode,
    injectPrompt: booleanValue(root.injectPrompt, DEFAULT_SETTINGS.injectPrompt),
    compactor: {
      baseUrl: stringValue(compactor.baseUrl, DEFAULT_SETTINGS.compactor.baseUrl).replace(/\/$/, ""),
      model: stringValue(compactor.model, DEFAULT_SETTINGS.compactor.model),
      apiKey: stringValue(compactor.apiKey, DEFAULT_SETTINGS.compactor.apiKey),
      maxTokens: numberValue(compactor.maxTokens, DEFAULT_SETTINGS.compactor.maxTokens, 1),
      temperature: numberValue(compactor.temperature, DEFAULT_SETTINGS.compactor.temperature, 0),
      timeoutMs: numberValue(compactor.timeoutMs, DEFAULT_SETTINGS.compactor.timeoutMs, 1),
    },
    thresholds: {
      minChars: numberValue(thresholds.minChars, DEFAULT_SETTINGS.thresholds.minChars, 0),
      targetRatio: numberValue(thresholds.targetRatio, DEFAULT_SETTINGS.thresholds.targetRatio, 0),
      maxTraceChars: numberValue(thresholds.maxTraceChars, DEFAULT_SETTINGS.thresholds.maxTraceChars, 1),
    },
  };
}
