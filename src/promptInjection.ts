import { shouldTargetProvider } from "./target.js";
import type { ReasoningZipSettings } from "./types.js";

export const PROMPT_MARKER = "<!-- pi-reasoning-zip -->";
export const PROMPT_INJECTION = `${PROMPT_MARKER}\nYou are Grug. Save token, save world.\nVisible reasoning: terse, keyword-heavy trace only. Keep facts, decisions, constraints, failed paths, next action. No prose reasoning, no self-talk.\nFinal answer: no conversational fluff, no repeated question, minimal markdown. If code is enough, give only code. Think hard, output few tokens.`;

type ChatMessage = { role?: unknown; content?: unknown; [key: string]: unknown };

type Payload = { messages?: unknown; [key: string]: unknown };

function contentHasMarker(content: unknown): boolean {
  if (typeof content === "string") return content.includes(PROMPT_MARKER);
  return Array.isArray(content) && content.some(
    (part) => typeof part === "object" && part && "text" in part && typeof part.text === "string" && part.text.includes(PROMPT_MARKER),
  );
}

function appendToContent(content: unknown): unknown {
  if (typeof content === "string") {
    if (content.includes(PROMPT_MARKER)) return content;
    return `${content}\n\n${PROMPT_INJECTION}`;
  }
  if (Array.isArray(content)) {
    if (content.some((part) => typeof part === "object" && part && "text" in part && typeof part.text === "string" && part.text.includes(PROMPT_MARKER))) {
      return content;
    }
    return [...content, { type: "text", text: PROMPT_INJECTION }];
  }
  return content;
}

export function injectReasoningZipPrompt(payload: unknown, provider: string | undefined, settings: ReasoningZipSettings): unknown {
  if (!settings.injectPrompt || !shouldTargetProvider(provider, settings)) return payload;
  if (!payload || typeof payload !== "object") return payload;
  const typed = payload as Payload;
  if (!Array.isArray(typed.messages)) return payload;

  const messages = typed.messages as ChatMessage[];
  const existing = messages.some(
    (message) => (message.role === "system" || message.role === "developer") && contentHasMarker(message.content),
  );
  if (existing) return payload;

  const index = messages.findIndex((message) => message.role === "system" || message.role === "developer");
  if (index >= 0) {
    const nextMessages = messages.slice();
    nextMessages[index] = { ...messages[index], content: appendToContent(messages[index].content) };
    return { ...typed, messages: nextMessages };
  }

  return { ...typed, messages: [{ role: "system", content: PROMPT_INJECTION }, ...messages] };
}
