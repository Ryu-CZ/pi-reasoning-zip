import { buildCompactionPrompt } from "./compactPrompt.js";
import type { ReasoningZipSettings } from "./types.js";

export async function compactWithOpenAI(thinking: string, settings: ReasoningZipSettings): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.compactor.timeoutMs);
  try {
    const response = await fetch(`${settings.compactor.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${settings.compactor.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.compactor.model,
        messages: [
          { role: "system", content: "You compress reasoning traces. Output only compact trace." },
          { role: "user", content: buildCompactionPrompt(thinking) },
        ],
        max_tokens: settings.compactor.maxTokens,
        temperature: settings.compactor.temperature,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`Compactor HTTP ${response.status}`);
    const json = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Compactor response missing message content");
    return content.trim();
  } finally {
    clearTimeout(timeout);
  }
}
