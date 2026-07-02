import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { compactWithOpenAI } from "./compactorClient.js";
import { compactAssistantMessage } from "./messageTransform.js";
import { injectReasoningZipPrompt } from "./promptInjection.js";
import { resolveReasoningZipSettings } from "./settings.js";

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

function eventProvider(event: Record<string, unknown>): string | undefined {
  const message = event.message as { provider?: unknown } | undefined;
  if (typeof message?.provider === "string") return message.provider;
  if (typeof event.provider === "string") return event.provider;
  return undefined;
}

export default function reasoningZipExtension(pi: ExtensionAPI) {
  const extension = pi as any;

  extension.on("message_end", async (event: any, ctx: any) => {
    const settings = resolveReasoningZipSettings(readRawSettings(ctx?.cwd));
    const result = await compactAssistantMessage(event.message, settings, (thinking) => compactWithOpenAI(thinking, settings));
    if (result.changed) return { message: result.message };
    return undefined;
  });

  extension.on("before_provider_request", (event: any, ctx: any) => {
    const settings = resolveReasoningZipSettings(readRawSettings(ctx?.cwd));
    const nextPayload = injectReasoningZipPrompt(event.payload, eventProvider(event), settings);
    return nextPayload === event.payload ? undefined : nextPayload;
  });
}
