import type { PiMessage, ReasoningZipSettings } from "./types.js";

export function isLlamaProvider(providerId: string | undefined): boolean {
  if (!providerId) return false;
  const id = providerId.toLowerCase();
  return id.startsWith("llama-server=") || id.includes("llama.cpp") || id.includes("llamacpp");
}

export function isLocalUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value.includes("://") ? value : `http://${value}`);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    return ["127.0.0.1", "localhost", "::1", "0.0.0.0"].includes(hostname);
  } catch {
    return false;
  }
}

function isLocalProvider(providerId: string | undefined): boolean {
  if (!providerId) return false;
  const llamaServerPrefix = "llama-server=";
  if (providerId.toLowerCase().startsWith(llamaServerPrefix)) {
    return isLocalUrl(providerId.slice(llamaServerPrefix.length));
  }
  return isLocalUrl(providerId);
}

export function shouldHandleMessage(message: PiMessage, settings: ReasoningZipSettings): boolean {
  if (!settings.enabled || settings.mode === "disabled" || settings.storageMode !== "compact-new") return false;
  if (message.role !== "assistant") return false;

  const provider = typeof message.provider === "string" ? message.provider : undefined;
  if (settings.mode === "all") return true;
  if (settings.mode === "llama-only") return isLlamaProvider(provider);
  if (settings.mode === "local-only") return isLocalProvider(provider);
  return false;
}

export function shouldTargetProvider(provider: string | undefined, settings: ReasoningZipSettings): boolean {
  if (!settings.enabled || settings.mode === "disabled") return false;
  if (settings.mode === "all") return true;
  if (settings.mode === "llama-only") return isLlamaProvider(provider);
  if (settings.mode === "local-only") return isLocalProvider(provider);
  return false;
}
