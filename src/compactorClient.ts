import { buildCompactionPrompt } from "./compactPrompt.js";
import type { ReasoningZipSettings } from "./types.js";

const CONTEXT_CACHE_TTL_MS = 5 * 60_000;
const PROMPT_RESERVE_TOKENS = 1024;
const contextCache = new Map<string, { contextTokens?: number; expiresAt: number }>();

function outputTokenBudget(thinking: string, settings: ReasoningZipSettings): number {
  const estimatedInputTokens = Math.ceil(thinking.length / 3);
  return Math.ceil(estimatedInputTokens * settings.compactor.maxCompactionRatio);
}

function buildPayload(thinking: string, settings: ReasoningZipSettings, disableThinking: boolean): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: settings.compactor.model,
    messages: [
      { role: "system", content: "You compress reasoning traces. Output only compact trace." },
      { role: "user", content: buildCompactionPrompt(thinking) },
    ],
    max_tokens: outputTokenBudget(thinking, settings),
    temperature: settings.compactor.temperature,
    ...(disableThinking
      ? {
          chat_template_kwargs: { enable_thinking: false },
          thinking_budget_tokens: 0,
        }
      : {}),
  };

  if (settings.llamaCppSlots.enabled === true) {
    // llama.cpp `--parallel N` creates N slots. Pin compaction to its own
    // id_slot so this side request does not replace the main chat slot's KV
    // cache and force the next user turn to re-process the full prompt.
    if (settings.llamaCppSlots.compactorIdSlot === settings.llamaCppSlots.mainIdSlot) {
      throw new Error("llama.cpp main and compactor id_slot must differ");
    }
    payload.id_slot = settings.llamaCppSlots.compactorIdSlot;
    payload.cache_prompt = true;
  }

  return payload;
}

function contextCacheKey(settings: ReasoningZipSettings): string {
  return `${settings.compactor.baseUrl}\n${settings.compactor.model}`;
}

async function inputCharacterLimit(settings: ReasoningZipSettings, signal: AbortSignal): Promise<number> {
  const key = contextCacheKey(settings);
  const cached = contextCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.contextTokens === undefined
      ? settings.thresholds.fallbackMaxInputChars
      : Math.max(1, Math.floor((cached.contextTokens - PROMPT_RESERVE_TOKENS) / (1 + settings.compactor.maxCompactionRatio)) * 3);
  }

  let contextTokens: number | undefined;
  try {
    const response = await fetch(`${settings.compactor.baseUrl}/models`, {
      headers: { authorization: `Bearer ${settings.compactor.apiKey}` },
      signal,
    });
    if (response.ok) {
      const json = await response.json() as { data?: Array<{ id?: unknown; meta?: { n_ctx?: unknown } }> };
      const model = json.data?.find((entry) => entry.id === settings.compactor.model);
      const nCtx = model?.meta?.n_ctx;
      if (typeof nCtx === "number" && Number.isFinite(nCtx) && nCtx > PROMPT_RESERVE_TOKENS) contextTokens = nCtx;
    }
  } catch {
    if (signal.aborted) throw new Error("Compactor context discovery aborted");
  }

  contextCache.set(key, { contextTokens, expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS });
  return contextTokens === undefined
    ? settings.thresholds.fallbackMaxInputChars
    : Math.max(1, Math.floor((contextTokens - PROMPT_RESERVE_TOKENS) / (1 + settings.compactor.maxCompactionRatio)) * 3);
}

async function postCompactionRequest(
  thinking: string,
  settings: ReasoningZipSettings,
  signal: AbortSignal,
  disableThinking: boolean,
): Promise<Response> {
  return await fetch(`${settings.compactor.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.compactor.apiKey}`,
    },
    body: JSON.stringify(buildPayload(thinking, settings, disableThinking)),
    signal,
  });
}

export async function compactWithOpenAI(thinking: string, settings: ReasoningZipSettings): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.compactor.timeoutMs);
  try {
    if (thinking.length > await inputCharacterLimit(settings, controller.signal)) return undefined;
    let response = await postCompactionRequest(thinking, settings, controller.signal, true);

    // Some strict OpenAI-compatible endpoints reject llama.cpp-specific
    // thinking controls. Retry once without them for compatibility.
    if (response.status === 400 || response.status === 422) {
      response = await postCompactionRequest(thinking, settings, controller.signal, false);
    }

    if (!response.ok) throw new Error(`Compactor HTTP ${response.status}`);
    const json = (await response.json()) as {
      choices?: Array<{
        finish_reason?: unknown;
        message?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown };
      }>;
    };
    const choice = json?.choices?.[0];
    if (choice?.finish_reason === "length" || choice?.finish_reason === "max_tokens") {
      throw new Error("Compactor response was truncated");
    }
    const content = choice?.message?.content;
    if (typeof content !== "string") throw new Error("Compactor response missing message content");
    const compacted = content.trim();
    if (!compacted) throw new Error("Compactor response has empty message content");
    if (
      /<\s*\/?\s*(?:think|thinking|reasoning|analysis)\b[^>]*>/i.test(compacted)
      || /<\|channel\|>\s*analysis/i.test(compacted)
    ) {
      throw new Error("Compactor response contains inline reasoning");
    }
    return compacted;
  } finally {
    clearTimeout(timeout);
  }
}
