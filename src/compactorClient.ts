import { buildCompactionPrompt } from "./compactPrompt.js";
import type { ReasoningZipSettings } from "./types.js";

function buildPayload(thinking: string, settings: ReasoningZipSettings, disableThinking: boolean): Record<string, unknown> {
  return {
    model: settings.compactor.model,
    messages: [
      { role: "system", content: "You compress reasoning traces. Output only compact trace." },
      { role: "user", content: buildCompactionPrompt(thinking, settings.compressionRole) },
    ],
    max_tokens: settings.compactor.maxTokens,
    temperature: settings.compactor.temperature,
    ...(disableThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
  };
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

export async function compactWithOpenAI(thinking: string, settings: ReasoningZipSettings): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.compactor.timeoutMs);
  try {
    let response = await postCompactionRequest(thinking, settings, controller.signal, true);

    // Some strict OpenAI-compatible endpoints reject llama.cpp/Qwen-specific
    // chat_template_kwargs. Retry once without it for compatibility.
    if (response.status === 400 || response.status === 422) {
      response = await postCompactionRequest(thinking, settings, controller.signal, false);
    }

    if (!response.ok) throw new Error(`Compactor HTTP ${response.status}`);
    const json = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Compactor response missing message content");
    return content.trim();
  } finally {
    clearTimeout(timeout);
  }
}
