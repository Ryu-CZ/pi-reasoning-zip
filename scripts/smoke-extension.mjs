import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import reasoningZipExtension from "../dist/index.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const cwd = await mkdtemp(join(tmpdir(), "pi-reasoning-zip-smoke-"));
try {
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify({
      reasoningZip: {
        mode: "llama-only",
        thresholds: { minChars: 5, targetRatio: 1, maxTraceChars: 100 },
        compactor: { baseUrl: "http://mock.local/v1", model: "mock", timeoutMs: 1000 },
      },
    }),
    "utf8",
  );

  const handlers = new Map();
  reasoningZipExtension({ on: (name, handler) => handlers.set(name, handler) });

  assert(handlers.has("message_end"), "message_end hook was not registered");
  assert(handlers.has("before_provider_request"), "before_provider_request hook was not registered");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert(String(url) === "http://mock.local/v1/chat/completions", "compactor URL mismatch");
    const body = JSON.parse(init.body);
    assert(body.messages[1].content.includes("abcdefghijklmnopqrstuvwxyz"), "compactor prompt missing thinking text");
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "facts:\n- smoke compacted" } }] }),
    };
  };

  try {
    const compacted = await handlers.get("message_end")(
      {
        message: {
          role: "assistant",
          provider: "llama-server=http://127.0.0.1:7484",
          content: [
            { type: "text", text: "answer" },
            { type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" },
          ],
          metadata: { keep: true },
        },
      },
      { cwd },
    );

    assert(compacted?.message?.content?.[0]?.text === "answer", "text block was not preserved");
    assert(compacted.message.content[1].thinking === "facts:\n- smoke compacted", "thinking block was not compacted");
    assert(compacted.message.metadata.keep === true, "assistant metadata was not preserved");

    const injected = handlers.get("before_provider_request")(
      {
        provider: "llama-server=http://127.0.0.1:7484",
        payload: { messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }] },
      },
      { cwd },
    );
    assert(injected.messages[0].content.includes("<!-- pi-reasoning-zip -->"), "prompt marker was not injected");

    const skipped = handlers.get("before_provider_request")(
      { provider: "openai", payload: { messages: [{ role: "system", content: "sys" }] } },
      { cwd },
    );
    assert(skipped === undefined, "non-target provider should not be modified");
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("pi-reasoning-zip smoke passed");
} finally {
  await rm(cwd, { recursive: true, force: true });
}
