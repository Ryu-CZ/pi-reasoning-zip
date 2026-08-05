import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ReasoningZipMode, ReasoningZipSettings, ReasoningZipSlotMode } from "./types.js";

export const DEFAULT_SETTINGS: ReasoningZipSettings = {
  enabled: true,
  mode: "local-only",
  footerStatus: "🗜️ Zip",
  llamaCppSlots: {
    enabled: false,
    mainIdSlot: 0,
    compactorIdSlot: 1,
  },
  compactor: {
    baseUrl: "http://127.0.0.1:7484/v1",
    model: "unsloth",
    apiKey: "sk-placeholder",
    maxCompactionRatio: 0.75,
    temperature: 0.1,
    timeoutMs: 30000,
  },
  thresholds: {
    minChars: 1000,
    maxInputChars: 50000,
    maxTraceChars: 2000,
  },
};

const modes = new Set<ReasoningZipMode>(["llama-only", "local-only", "all"]);

export type SettingsScope = "global" | "project";

interface SettingsDocument {
  [key: string]: unknown;
}

export interface EnabledSettingInspection {
  value: boolean;
  source: SettingsScope | "built-in";
  path?: string;
}

export interface EnabledSettingWriteResult {
  scope: SettingsScope;
  path: string;
  value: boolean;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function slotModeValue(value: unknown, fallback: ReasoningZipSlotMode): ReasoningZipSlotMode {
  return value === "auto" || typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback: number, min = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min ? value : fallback;
}

function optionalFraction(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1 ? value : undefined;
}

function integerValue(value: unknown, fallback: number, min = 0): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min ? value : fallback;
}

export function settingsPath(scope: SettingsScope, cwd = process.cwd()): string {
  if (scope === "project") return join(resolve(cwd), ".pi", "settings.json");
  return join(process.env.PI_CODING_AGENT_DIR ? resolve(process.env.PI_CODING_AGENT_DIR) : join(homedir(), ".pi", "agent"), "settings.json");
}

async function readSettingsDocument(path: string): Promise<SettingsDocument> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return asObject(parsed);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}

async function inspectEnabledInScope(scope: SettingsScope, cwd: string): Promise<EnabledSettingInspection | undefined> {
  const path = settingsPath(scope, cwd);
  const section = asObject((await readSettingsDocument(path)).reasoningZip);
  if (!("enabled" in section)) return undefined;
  return { value: booleanValue(section.enabled, DEFAULT_SETTINGS.enabled), source: scope, path };
}

async function hasReasoningZipSection(scope: SettingsScope, cwd: string): Promise<boolean> {
  const section = (await readSettingsDocument(settingsPath(scope, cwd))).reasoningZip;
  return Boolean(section && typeof section === "object" && !Array.isArray(section));
}

export async function inspectEnabledSetting(cwd = process.cwd(), scope?: SettingsScope): Promise<EnabledSettingInspection> {
  if (scope) return await inspectEnabledInScope(scope, cwd) ?? { value: DEFAULT_SETTINGS.enabled, source: "built-in", path: settingsPath(scope, cwd) };
  return await inspectEnabledInScope("project", cwd)
    ?? await inspectEnabledInScope("global", cwd)
    ?? { value: DEFAULT_SETTINGS.enabled, source: "built-in" };
}

async function chooseEnabledSettingScope(cwd: string, requestedScope?: SettingsScope): Promise<SettingsScope> {
  if (requestedScope) return requestedScope;
  if (await inspectEnabledInScope("project", cwd) || await hasReasoningZipSection("project", cwd)) return "project";
  if (await inspectEnabledInScope("global", cwd) || await hasReasoningZipSection("global", cwd)) return "global";
  return "global";
}

export async function writeEnabledSetting(cwd: string, value: boolean, requestedScope?: SettingsScope): Promise<EnabledSettingWriteResult> {
  const scope = await chooseEnabledSettingScope(cwd, requestedScope);
  const path = settingsPath(scope, cwd);
  const document = await readSettingsDocument(path);
  document.reasoningZip = { ...asObject(document.reasoningZip), enabled: value };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return { scope, path, value };
}

export function resolveReasoningZipSettings(input: unknown): ReasoningZipSettings {
  const root = asObject(input);
  const compactor = asObject(root.compactor);
  const thresholds = asObject(root.thresholds);
  const llamaCppSlots = asObject(root.llamaCppSlots);

  const mode = modes.has(root.mode as ReasoningZipMode) ? (root.mode as ReasoningZipMode) : DEFAULT_SETTINGS.mode;
  return {
    enabled: booleanValue(root.enabled, DEFAULT_SETTINGS.enabled),
    mode,
    footerStatus: stringValue(root.footerStatus, DEFAULT_SETTINGS.footerStatus),
    llamaCppSlots: {
      enabled: slotModeValue(llamaCppSlots.enabled, DEFAULT_SETTINGS.llamaCppSlots.enabled),
      mainIdSlot: integerValue(llamaCppSlots.mainIdSlot, DEFAULT_SETTINGS.llamaCppSlots.mainIdSlot, 0),
      compactorIdSlot: integerValue(llamaCppSlots.compactorIdSlot, DEFAULT_SETTINGS.llamaCppSlots.compactorIdSlot, 0),
    },
    compactor: {
      baseUrl: stringValue(compactor.baseUrl, DEFAULT_SETTINGS.compactor.baseUrl).replace(/\/+$/, ""),
      model: stringValue(compactor.model, DEFAULT_SETTINGS.compactor.model),
      apiKey: stringValue(compactor.apiKey, DEFAULT_SETTINGS.compactor.apiKey),
      maxCompactionRatio: optionalFraction(compactor.maxCompactionRatio) ?? DEFAULT_SETTINGS.compactor.maxCompactionRatio,
      temperature: numberValue(compactor.temperature, DEFAULT_SETTINGS.compactor.temperature, 0),
      timeoutMs: numberValue(compactor.timeoutMs, DEFAULT_SETTINGS.compactor.timeoutMs, 1),
    },
    thresholds: {
      minChars: numberValue(thresholds.minChars, DEFAULT_SETTINGS.thresholds.minChars, 0),
      maxInputChars: numberValue(thresholds.maxInputChars, DEFAULT_SETTINGS.thresholds.maxInputChars, 1),
      maxTraceChars: numberValue(thresholds.maxTraceChars, DEFAULT_SETTINGS.thresholds.maxTraceChars, 1),
    },
  };
}
