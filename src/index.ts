import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { compactWithOpenAI } from "./compactorClient.js";
import { compactAssistantMessage } from "./messageTransform.js";
import { injectReasoningZipPrompt } from "./promptInjection.js";
import { inspectEnabledSetting, resolveReasoningZipSettings, type SettingsScope, writeEnabledSetting } from "./settings.js";
import type { PiMessage } from "./types.js";

// Minimal structural types for the Pi hooks and command surface we consume.
// Avoids `pi as any` while staying independent of upstream type changes.

const FOOTER_STATUS_KEY = "reasoning-zip";

interface HookContext {
  cwd?: string;
  model?: { provider?: string };
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
    ) => unknown | undefined,
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

function readRawSettings(cwd: string | undefined): unknown {
  return readSettingsSection(projectSettingsPath(cwd)) ?? readSettingsSection(globalSettingsPath());
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

function cwdFromContext(ctx: unknown): string {
  return (ctx && typeof ctx === "object" && typeof (ctx as PiCommandContext).cwd === "string") ? (ctx as PiCommandContext).cwd! : process.cwd();
}

function notify(ctx: unknown, message: string, level = "info"): void {
  if (ctx && typeof ctx === "object") (ctx as PiCommandContext).ui?.notify?.(message, level);
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

export default function reasoningZipExtension(pi: ExtensionAPI) {
  const extension = pi as unknown as ReasoningZipExtension;

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
    const result = await compactAssistantMessage(event.message, settings, (thinking) => compactWithOpenAI(thinking, settings));
    if (result.changed) return { message: result.message };
    return undefined;
  });

  extension.on("before_provider_request", (event, ctx) => {
    const settings = resolveReasoningZipSettings(readRawSettings(ctx?.cwd));
    setFooterStatus(ctx, settings.enabled);
    const nextPayload = injectReasoningZipPrompt(event.payload, eventProvider(event, ctx), settings);
    return nextPayload === event.payload ? undefined : nextPayload;
  });
}
