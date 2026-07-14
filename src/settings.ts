import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ReasoningZipCompressionRole, ReasoningZipMode, ReasoningZipSettings, ReasoningZipStorageMode } from "./types.js";

export const DEFAULT_SETTINGS: ReasoningZipSettings = {
  enabled: true,
  mode: "local-only",
  storageMode: "compact-new",
  compressionRole: "grug",
  injectPrompt: true,
  footerStatus: "🗜️ Zip",
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
    maxInputChars: 50000,
    maxTraceChars: 2000,
  },
};

const modes = new Set<ReasoningZipMode>(["llama-only", "local-only", "all", "disabled"]);
const storageModes = new Set<ReasoningZipStorageMode>(["compact-new", "off"]);
const compressionRoles = new Set<ReasoningZipCompressionRole>(["balanced", "grug", "ultra-grug"]);

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

function numberValue(value: unknown, fallback: number, min = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min ? value : fallback;
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

  const mode = modes.has(root.mode as ReasoningZipMode) ? (root.mode as ReasoningZipMode) : DEFAULT_SETTINGS.mode;
  const storageMode = storageModes.has(root.storageMode as ReasoningZipStorageMode)
    ? (root.storageMode as ReasoningZipStorageMode)
    : DEFAULT_SETTINGS.storageMode;
  const compressionRole = compressionRoles.has(root.compressionRole as ReasoningZipCompressionRole)
    ? (root.compressionRole as ReasoningZipCompressionRole)
    : DEFAULT_SETTINGS.compressionRole;

  return {
    enabled: booleanValue(root.enabled, DEFAULT_SETTINGS.enabled),
    mode,
    storageMode,
    compressionRole,
    injectPrompt: booleanValue(root.injectPrompt, DEFAULT_SETTINGS.injectPrompt),
    footerStatus: stringValue(root.footerStatus, DEFAULT_SETTINGS.footerStatus),
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
      maxInputChars: numberValue(thresholds.maxInputChars, DEFAULT_SETTINGS.thresholds.maxInputChars, 1),
      maxTraceChars: numberValue(thresholds.maxTraceChars, DEFAULT_SETTINGS.thresholds.maxTraceChars, 1),
    },
  };
}
