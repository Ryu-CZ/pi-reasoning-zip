import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { compactWithOpenAI } from "./compactorClient.js";
import { compactAssistantMessage } from "./messageTransform.js";
import { injectReasoningZipPrompt } from "./promptInjection.js";
import { resolveReasoningZipSettings } from "./settings.js";
import type { PiMessage } from "./types.js";

// Minimal structural types for the two Pi hooks we consume.
// Avoids `pi as any` while staying independent of upstream type changes.

interface HookContext {
  cwd?: string;
}

interface MessageEndEvent {
  message: PiMessage;
}

interface BeforeProviderRequestEvent {
  payload: unknown;
  message?: { provider?: string };
  provider?: string;
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

function eventProvider(event: BeforeProviderRequestEvent): string | undefined {
  if (typeof event.message?.provider === "string") return event.message.provider;
  if (typeof event.provider === "string") return event.provider;
  return undefined;
}

export default function reasoningZipExtension(pi: ExtensionAPI) {
  const extension = pi as unknown as ReasoningZipExtension;

  extension.on("message_end", async (event, ctx) => {
    const settings = resolveReasoningZipSettings(readRawSettings(ctx?.cwd));
    const result = await compactAssistantMessage(event.message, settings, (thinking) => compactWithOpenAI(thinking, settings));
    if (result.changed) return { message: result.message };
    return undefined;
  });

  extension.on("before_provider_request", (event, ctx) => {
    const settings = resolveReasoningZipSettings(readRawSettings(ctx?.cwd));
    const nextPayload = injectReasoningZipPrompt(event.payload, eventProvider(event), settings);
    return nextPayload === event.payload ? undefined : nextPayload;
  });
}
