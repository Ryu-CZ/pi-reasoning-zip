export type ReasoningZipMode = "llama-only" | "local-only" | "all" | "disabled";
export type ReasoningZipStorageMode = "compact-new" | "off";

export interface ReasoningZipSettings {
  enabled: boolean;
  mode: ReasoningZipMode;
  storageMode: ReasoningZipStorageMode;
  injectPrompt: boolean;
  compactor: {
    baseUrl: string;
    model: string;
    apiKey: string;
    maxTokens: number;
    temperature: number;
    timeoutMs: number;
  };
  thresholds: {
    minChars: number;
    targetRatio: number;
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
