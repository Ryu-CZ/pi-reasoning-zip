import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { compactWithOpenAI } from "./compactorClient.js";
import { compactAssistantMessage, hasCompactionCandidate } from "./messageTransform.js";
import { injectLlamaCppMainSlot } from "./slotInjection.js";
import { inspectEnabledSetting, resolveReasoningZipSettings, type SettingsScope, writeEnabledSetting } from "./settings.js";
import { isLlamaProvider } from "./target.js";
import type { AutoSlotDecision, PiMessage, ReasoningZipSettings } from "./types.js";

// Minimal structural types for the Pi hooks and command surface we consume.
// Avoids `pi as any` while staying independent of upstream type changes.

const FOOTER_STATUS_KEY = "reasoning-zip";

interface HookContext {
  cwd?: string;
  model?: { id?: string; provider?: string; baseUrl?: string };
  signal?: AbortSignal;
}

interface MessageEndEvent {
  message: PiMessage;
}

interface BeforeProviderRequestEvent {
  payload: unknown;
  message?: { provider?: string };
  provider?: string;
}

interface PiCommandContext {
  cwd?: string;
  ui?: {
    notify?(message: string, level?: string): void;
    setStatus?(key: string, value: string | undefined): void;
  };
}

interface ReasoningZipExtension {
  on(
    event: "message_end",
    handler: (
      event: MessageEndEvent,
      ctx: HookContext,
    ) => Promise<{ message: PiMessage } | undefined>,
  ): void;
  on(
    event: "before_provider_request",
    handler: (
      event: BeforeProviderRequestEvent,
      ctx: HookContext,
    ) => Promise<unknown | undefined> | unknown | undefined,
  ): void;
  on(event: "session_start" | "session_shutdown", handler: (event: unknown, ctx: HookContext) => unknown | undefined): void;
  registerCommand?(name: string, command: { description?: string; handler: (args: unknown, ctx: unknown) => unknown }): void;
}

function globalSettingsPath(): string {
  return join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "settings.json");
}

function projectSettingsPath(cwd: string | undefined): string | undefined {
  return cwd ? join(cwd, ".pi", "settings.json") : undefined;
}

function readSettingsSection(path: string | undefined): unknown {
  if (!path) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { reasoningZip?: unknown };
    return parsed.reasoningZip;
  } catch {
    return undefined;
  }
}

function isSettingsObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function mergeSettingsObjects(globalValue: Record<string, unknown>, projectValue: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...globalValue };
  for (const [key, value] of Object.entries(projectValue)) {
    const inherited = merged[key];
    merged[key] = isSettingsObject(inherited) && isSettingsObject(value)
      ? mergeSettingsObjects(inherited, value)
      : value;
  }
  return merged;
}

function readRawSettings(cwd: string | undefined): unknown {
  const globalSettings = readSettingsSection(globalSettingsPath());
  const projectSettings = readSettingsSection(projectSettingsPath(cwd));
  if (!isSettingsObject(projectSettings)) return globalSettings;
  const runtimeProjectSettings = { ...projectSettings };
  delete runtimeProjectSettings.footerStatus;
  return mergeSettingsObjects(isSettingsObject(globalSettings) ? globalSettings : {}, runtimeProjectSettings);
}

function readGlobalSettings(): unknown {
  return readSettingsSection(globalSettingsPath());
}

function readFooterStatus(): string {
  return resolveReasoningZipSettings(readGlobalSettings()).footerStatus;
}

function eventProvider(event: BeforeProviderRequestEvent, ctx: HookContext): string | undefined {
  if (typeof event.message?.provider === "string") return event.message.provider;
  if (typeof event.provider === "string") return event.provider;
  if (typeof ctx.model?.provider === "string") return ctx.model.provider;
  return undefined;
}

function messageProvider(message: PiMessage, ctx: HookContext): string | undefined {
  if (typeof message.provider === "string") return message.provider;
  if (typeof ctx.model?.provider === "string") return ctx.model.provider;
  return undefined;
}

function providerBaseUrl(provider: string | undefined, ctx: HookContext): string | undefined {
  const prefix = "llama-server=";
  if (provider?.toLowerCase().startsWith(prefix)) return provider.slice(prefix.length);
  return typeof ctx.model?.baseUrl === "string" ? ctx.model.baseUrl : undefined;
}

function normalizedServerBase(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return undefined;
  try {
    const url = new URL(baseUrl);
    url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "") || "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function sameServerEndpoint(a: string | undefined, b: string | undefined): boolean {
  const first = normalizedServerBase(a);
  const second = normalizedServerBase(b);
  return first !== undefined && first === second;
}

function isSlotCapableProvider(provider: string | undefined, ctx: HookContext, settings: ReasoningZipSettings): boolean {
  return isLlamaProvider(provider) || sameServerEndpoint(providerBaseUrl(provider, ctx), settings.compactor.baseUrl);
}

function slotsUrl(baseUrl: string): string | undefined {
  try {
    const url = new URL(baseUrl);
    url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "") || "/";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/slots`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function withSlotPinning(settings: ReasoningZipSettings, enabled: boolean): ReasoningZipSettings {
  return { ...settings, llamaCppSlots: { ...settings.llamaCppSlots, enabled } };
}

const SLOT_PROBE_TIMEOUT_MS = 2000;
const SLOT_PROBE_CACHE_MS = 5000;

async function probeLlamaCppSlotCount(
  baseUrl: string,
  apiKey: string,
  pendingSlotProbes: Map<string, Promise<number | undefined>>,
  completedSlotProbes: Map<string, { slotCount: number; expiresAt: number }>,
): Promise<number | undefined> {
  const url = slotsUrl(baseUrl);
  if (!url) return undefined;
  const probeKey = `${url}\n${apiKey}`;
  const cached = completedSlotProbes.get(probeKey);
  if (cached && cached.expiresAt > Date.now()) return cached.slotCount;
  if (cached) completedSlotProbes.delete(probeKey);
  const existing = pendingSlotProbes.get(probeKey);
  if (existing) return existing;

  const pending = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SLOT_PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) return undefined;
      const json = await response.json() as unknown;
      return Array.isArray(json) ? json.length : undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  })();

  pendingSlotProbes.set(probeKey, pending);
  try {
    const slotCount = await pending;
    if (slotCount !== undefined) {
      completedSlotProbes.set(probeKey, { slotCount, expiresAt: Date.now() + SLOT_PROBE_CACHE_MS });
    }
    return slotCount;
  } finally {
    pendingSlotProbes.delete(probeKey);
  }
}

function normalizeIdSlot(id: number, slotCount: number): number {
  return ((id % slotCount) + slotCount) % slotCount;
}

function idsCollide(mainId: number, compactorId: number, slotCount: number): boolean {
  return normalizeIdSlot(mainId, slotCount) === normalizeIdSlot(compactorId, slotCount);
}

async function shouldPinSlots(
  provider: string | undefined,
  ctx: HookContext,
  settings: ReasoningZipSettings,
  pendingSlotProbes: Map<string, Promise<number | undefined>>,
  completedSlotProbes: Map<string, { slotCount: number; expiresAt: number }>,
): Promise<AutoSlotDecision> {
  // Auto mode is conservative: only pin when the shared local llama.cpp server
  // reports at least two parallel slots. With one slot, id_slot wraps to the
  // only slot and cannot prevent prompt/KV cache invalidation.
  if (!settings.enabled || settings.mode === "disabled" || settings.storageMode !== "compact-new") {
    return { pinning: false, skipCompactor: false };
  }
  if (!isSlotCapableProvider(provider, ctx, settings)) {
    return { pinning: false, skipCompactor: false };
  }
  if (settings.llamaCppSlots.enabled === true) {
    return { pinning: true, skipCompactor: false };
  }
  if (settings.llamaCppSlots.enabled !== "auto") {
    return { pinning: false, skipCompactor: false };
  }
  const mainBaseUrl = providerBaseUrl(provider, ctx);
  const normalizedMainBaseUrl = normalizedServerBase(mainBaseUrl);
  const normalizedCompactorBaseUrl = normalizedServerBase(settings.compactor.baseUrl);
  if (normalizedMainBaseUrl === undefined || normalizedCompactorBaseUrl === undefined) {
    return { pinning: false, skipCompactor: true };
  }
  if (normalizedMainBaseUrl !== normalizedCompactorBaseUrl) {
    // Different servers — safe to compact normally without pinning.
    return { pinning: false, skipCompactor: false };
  }
  // Shared server: probe for slot count.
  const slotCount = await probeLlamaCppSlotCount(
    settings.compactor.baseUrl,
    settings.compactor.apiKey,
    pendingSlotProbes,
    completedSlotProbes,
  );
  // Probe failed or count < 2 → fail closed: no compactor, no pinning.
  if (slotCount === undefined || slotCount < 2) {
    return { pinning: false, slotCount, skipCompactor: true };
  }
  // Check normalized IDs don't collide.
  if (idsCollide(settings.llamaCppSlots.mainIdSlot, settings.llamaCppSlots.compactorIdSlot, slotCount)) {
    return { pinning: false, slotCount, skipCompactor: true };
  }
  return { pinning: true, slotCount, skipCompactor: false };
}

function cwdFromContext(ctx: unknown): string {
  return (ctx && typeof ctx === "object" && typeof (ctx as PiCommandContext).cwd === "string") ? (ctx as PiCommandContext).cwd! : process.cwd();
}

function notify(ctx: unknown, message: string, level = "info"): void {
  if (ctx && typeof ctx === "object") (ctx as PiCommandContext).ui?.notify?.(message, level);
}

function notifyCompactionFailures(ctx: unknown, failures: number): void {
  if (failures > 0) {
    notify(ctx, "pi-reasoning-zip compaction failed; original reasoning was preserved.", "warning");
  }
}

function setFooterStatus(ctx: unknown, enabled: boolean): void {
  try {
    if (ctx && typeof ctx === "object") (ctx as PiCommandContext).ui?.setStatus?.(FOOTER_STATUS_KEY, enabled ? readFooterStatus() : undefined);
  } catch {
    return;
  }
}

function parseScope(value: string | undefined): SettingsScope | undefined {
  if (value === "global" || value === "user") return "global";
  if (value === "project" || value === "local") return "project";
  return undefined;
}

function enabledLabel(value: boolean): string {
  return value ? "enabled" : "disabled";
}

function scopeLabel(source: string): string {
  return source === "built-in" ? "built-in default" : `${source} settings`;
}

async function handleReasoningZipCommand(args: unknown, ctx: unknown): Promise<string> {
  const parts = typeof args === "string" ? args.trim().toLowerCase().split(/\s+/).filter(Boolean) : [];
  const command = parts[0] || "status";
  const requestedScope = parseScope(parts[1]) ?? parseScope(command);
  const cwd = cwdFromContext(ctx);

  if (command === "" || command === "status" || requestedScope && parts.length === 1) {
    const setting = await inspectEnabledSetting(cwd, requestedScope);
    const path = setting.path ? ` (${setting.path})` : "";
    const message = `pi-reasoning-zip is ${enabledLabel(setting.value)} from ${scopeLabel(setting.source)}${path}.`;
    setFooterStatus(ctx, setting.value);
    notify(ctx, message, "info");
    return message;
  }

  const nextValue = command === "toggle"
    ? !(await inspectEnabledSetting(cwd)).value
    : ["on", "enable", "enabled"].includes(command)
      ? true
      : ["off", "disable", "disabled"].includes(command)
        ? false
        : undefined;

  if (nextValue !== undefined) {
    const result = await writeEnabledSetting(cwd, nextValue, requestedScope);
    const message = `pi-reasoning-zip is now ${enabledLabel(nextValue)} (${result.scope} settings: ${result.path}).`;
    setFooterStatus(ctx, nextValue);
    notify(ctx, message, "info");
    return message;
  }

  const message = "Usage: /reasoning-zip [status|on|off|enable|disable|toggle] [global|project]";
  notify(ctx, message, "warning");
  return message;
}

function conflictKey(cwd: string | undefined, provider: string | undefined): string {
  return `${cwd ?? ""}\n${provider ?? ""}`;
}

interface InFlightSlotState {
  decision: AutoSlotDecision;
  conflict: boolean;
  overlapping: boolean;
  extensionEnabled: boolean;
  mode: ReasoningZipSettings["mode"];
  storageMode: ReasoningZipSettings["storageMode"];
  slotMode: ReasoningZipSettings["llamaCppSlots"]["enabled"];
  mainIdSlot: number;
  compactorIdSlot: number;
  mainBaseUrl?: string;
  compactorBaseUrl: string;
  signal?: AbortSignal;
  abortHandler?: () => void;
}

function payloadModelId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const model = (payload as { model?: unknown }).model;
  return typeof model === "string" ? model : undefined;
}

function requestMatchesContextModel(event: BeforeProviderRequestEvent, ctx: HookContext): boolean {
  const requestModel = payloadModelId(event.payload);
  const contextModel = ctx.model?.id;
  return requestModel === undefined || (contextModel !== undefined && requestModel === contextModel);
}

function slotSettingsMatch(state: InFlightSlotState, provider: string | undefined, ctx: HookContext, settings: ReasoningZipSettings): boolean {
  return state.extensionEnabled === settings.enabled
    && state.mode === settings.mode
    && state.storageMode === settings.storageMode
    && state.slotMode === settings.llamaCppSlots.enabled
    && state.mainIdSlot === settings.llamaCppSlots.mainIdSlot
    && state.compactorIdSlot === settings.llamaCppSlots.compactorIdSlot
    && normalizedServerBase(state.mainBaseUrl) === normalizedServerBase(providerBaseUrl(provider, ctx))
    && normalizedServerBase(state.compactorBaseUrl) === normalizedServerBase(settings.compactor.baseUrl);
}

export default function reasoningZipExtension(pi: ExtensionAPI) {
  const extension = pi as unknown as ReasoningZipExtension;
  const inFlightSlotStates = new Map<string, InFlightSlotState>();
  const pendingSlotProbes = new Map<string, Promise<number | undefined>>();
  const completedSlotProbes = new Map<string, { slotCount: number; expiresAt: number }>();

  extension.registerCommand?.("reasoning-zip", {
    description: "Enable, disable, or inspect pi-reasoning-zip",
    handler: handleReasoningZipCommand,
  });

  extension.on("session_start", (_event, ctx) => {
    setFooterStatus(ctx, resolveReasoningZipSettings(readRawSettings(ctx?.cwd)).enabled);
  });

  extension.on("session_shutdown", (_event, ctx) => {
    setFooterStatus(ctx, false);
  });

  extension.on("message_end", async (event, ctx) => {
    const settings = resolveReasoningZipSettings(readRawSettings(ctx?.cwd));
    setFooterStatus(ctx, settings.enabled);
    const provider = messageProvider(event.message, ctx);
    const key = conflictKey(ctx?.cwd, provider);
    const state = inFlightSlotStates.get(key);
    if (state?.signal && state.abortHandler) state.signal.removeEventListener("abort", state.abortHandler);
    inFlightSlotStates.delete(key);

    if (!hasCompactionCandidate(event.message, settings)) return undefined;

    if (!state) {
      const mainBaseUrl = normalizedServerBase(providerBaseUrl(provider, ctx));
      const compactorBaseUrl = normalizedServerBase(settings.compactor.baseUrl);
      const isolationUnknownOrShared = mainBaseUrl === undefined
        || compactorBaseUrl === undefined
        || mainBaseUrl === compactorBaseUrl;
      if (settings.llamaCppSlots.enabled !== false
        && isSlotCapableProvider(provider, ctx, settings)
        && isolationUnknownOrShared) {
        notify(ctx, "pi-reasoning-zip cannot verify slot isolation for this response; original reasoning preserved.", "warning");
        return undefined;
      }
    } else if (!slotSettingsMatch(state, provider, ctx, settings)) {
      notify(ctx, "pi-reasoning-zip slot settings changed during generation; original reasoning preserved.", "warning");
      return undefined;
    } else if (state.conflict || state.overlapping) {
      if (state.overlapping) {
        notify(ctx, "pi-reasoning-zip overlapping provider requests cannot be correlated safely; original reasoning preserved.", "warning");
      }
      return undefined;
    }

    const decision = state?.decision ?? { pinning: false, skipCompactor: false };

    // Fail-closed: if auto mode determined shared-server isolation is unsafe,
    // skip the compactor entirely and warn.
    if (decision.skipCompactor) {
      notify(ctx, "pi-reasoning-zip safe llama.cpp slot isolation is unavailable; original reasoning preserved.", "warning");
      return undefined;
    }

    const effectiveSettings = withSlotPinning(settings, decision.pinning);
    const result = await compactAssistantMessage(event.message, effectiveSettings, (thinking) => compactWithOpenAI(thinking, effectiveSettings));
    notifyCompactionFailures(ctx, result.failures);
    if (result.changed) return { message: result.message };
    return undefined;
  });

  extension.on("before_provider_request", async (event, ctx) => {
    const settings = resolveReasoningZipSettings(readRawSettings(ctx?.cwd));
    setFooterStatus(ctx, settings.enabled);
    // Pi's hook omits the actual request model. When the payload explicitly
    // names a different model than ctx.model, attribution is unsafe; leave the
    // request untouched rather than pinning it for the wrong provider.
    if (!requestMatchesContextModel(event, ctx)) return undefined;
    const provider = eventProvider(event, ctx);
    const decision = await shouldPinSlots(provider, ctx, settings, pendingSlotProbes, completedSlotProbes);
    const key = conflictKey(ctx?.cwd, provider);
    const effectiveSettings = withSlotPinning(settings, decision.pinning);
    const slotResult = injectLlamaCppMainSlot(event.payload, provider, effectiveSettings, decision);
    const state: InFlightSlotState = {
      decision,
      conflict: slotResult.conflict,
      overlapping: false,
      extensionEnabled: settings.enabled,
      mode: settings.mode,
      storageMode: settings.storageMode,
      slotMode: settings.llamaCppSlots.enabled,
      mainIdSlot: settings.llamaCppSlots.mainIdSlot,
      compactorIdSlot: settings.llamaCppSlots.compactorIdSlot,
      mainBaseUrl: providerBaseUrl(provider, ctx),
      compactorBaseUrl: settings.compactor.baseUrl,
    };
    const trackSlotState = settings.llamaCppSlots.enabled !== false && isSlotCapableProvider(provider, ctx, settings);
    if (trackSlotState) {
      const existingState = inFlightSlotStates.get(key);
      if (existingState) {
        if (existingState.signal && existingState.abortHandler) {
          existingState.signal.removeEventListener("abort", existingState.abortHandler);
        }
        // A different active request signal means the earlier request ended
        // without message_end (for example, a provider error). Replace that
        // stale state. A shared or unavailable signal remains ambiguous.
        state.overlapping = existingState.signal === undefined
          || ctx.signal === undefined
          || existingState.signal === ctx.signal;
      }
      if (ctx.signal) {
        state.signal = ctx.signal;
        state.abortHandler = () => {
          if (inFlightSlotStates.get(key) === state) inFlightSlotStates.delete(key);
        };
        ctx.signal.addEventListener("abort", state.abortHandler, { once: true });
      }
      inFlightSlotStates.set(key, state);
    }
    if (slotResult.conflict) {
      notify(ctx, "pi-reasoning-zip llama.cpp id_slot conflict; original reasoning for this response will be preserved.", "warning");
    }
    return slotResult.changed ? slotResult.payload : undefined;
  });
}
