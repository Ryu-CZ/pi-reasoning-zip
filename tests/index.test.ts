import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import reasoningZipExtension from "../src/index.js";
import { PROMPT_MARKER } from "../src/promptInjection.js";

type Handler = (event: any, ctx?: any) => any;

function loadExtension(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  reasoningZipExtension({ on: (name: string, handler: Handler) => handlers.set(name, handler) } as any);
  return handlers;
}

let tempDirs: string[] = [];
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function tempProject(settings: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "reasoning-zip-test-"));
  tempDirs.push(dir);
  await mkdir(join(dir, ".pi"), { recursive: true });
  await writeFile(join(dir, ".pi", "settings.json"), JSON.stringify({ reasoningZip: settings }), "utf8");
  return dir;
}

describe("extension entrypoint", () => {
  it("registers message_end and before_provider_request hooks", () => {
    const handlers = loadExtension();
    expect(handlers.has("message_end")).toBe(true);
    expect(handlers.has("before_provider_request")).toBe(true);
  });

  it("message_end returns replacement only when compaction changes message", async () => {
    const cwd = await tempProject({ mode: "all", thresholds: { minChars: 5, maxTraceChars: 100 } });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "zip" } }] }),
    } as Response);
    const handler = loadExtension().get("message_end")!;

    const result = await handler(
      { message: { role: "assistant", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] } },
      { cwd },
    );

    expect(result.message.content[0].thinking).toBe("zip");
  });

  it("message_end returns undefined when unchanged", async () => {
    const cwd = await tempProject({ mode: "all", thresholds: { minChars: 1000 } });
    const handler = loadExtension().get("message_end")!;
    const result = await handler({ message: { role: "assistant", content: [{ type: "thinking", thinking: "short" }] } }, { cwd });
    expect(result).toBeUndefined();
  });

  it("before_provider_request injects only for changed payloads", async () => {
    const cwd = await tempProject({ mode: "llama-only" });
    const handler = loadExtension().get("before_provider_request")!;
    const injected = handler({ provider: "llama-server=http://127.0.0.1:7484", payload: { messages: [{ role: "system", content: "sys" }] } }, { cwd });
    expect(injected.messages[0].content).toContain(PROMPT_MARKER);

    const skipped = handler({ provider: "openai", payload: { messages: [{ role: "system", content: "sys" }] } }, { cwd });
    expect(skipped).toBeUndefined();
  });

  it("before_provider_request can target the real Pi ctx.model provider shape", async () => {
    const cwd = await tempProject({ mode: "llama-only" });
    const handler = loadExtension().get("before_provider_request")!;
    const injected = handler(
      { type: "before_provider_request", payload: { messages: [{ role: "system", content: "sys" }] } },
      { cwd, model: { provider: "llama-server=http://127.0.0.1:7484" } },
    );
    expect(injected.messages[0].content).toContain(PROMPT_MARKER);
  });
});
