import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

function loadExtensionSurface(): { handlers: Map<string, Handler>; commands: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, Handler>();
  reasoningZipExtension({
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    registerCommand: (name: string, command: { handler: Handler }) => commands.set(name, command.handler),
  } as any);
  return { handlers, commands };
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
  it("registers hooks, footer lifecycle, and reasoning-zip command", () => {
    const { handlers, commands } = loadExtensionSurface();
    expect(handlers.has("session_start")).toBe(true);
    expect(handlers.has("session_shutdown")).toBe(true);
    expect(handlers.has("message_end")).toBe(true);
    expect(handlers.has("before_provider_request")).toBe(true);
    expect(commands.has("reasoning-zip")).toBe(true);
  });

  it("reasoning-zip command maps enabled setting to project or global settings", async () => {
    const cwd = await tempProject({ mode: "all" });
    const command = loadExtensionSurface().commands.get("reasoning-zip")!;
    const notifications: string[] = [];
    const statuses: Record<string, string | undefined> = {};
    process.env.PI_CODING_AGENT_DIR = join(cwd, "agent");
    const ctx = {
      cwd,
      ui: {
        notify: (message: string) => notifications.push(message),
        setStatus: (key: string, value: string | undefined) => { statuses[key] = value; },
      },
    };

    expect(String(await command("status", ctx))).toContain("enabled from built-in default");
    expect(statuses["reasoning-zip"]).toBe("🗜️ Zip");
    expect(String(await command("disable", ctx))).toContain("disabled (project settings:");
    expect(statuses["reasoning-zip"]).toBeUndefined();

    const projectSettings = JSON.parse(await readFile(join(cwd, ".pi", "settings.json"), "utf8")) as { reasoningZip: { enabled: boolean; mode: string } };
    expect(projectSettings.reasoningZip.enabled).toBe(false);
    expect(projectSettings.reasoningZip.mode).toBe("all");
    expect(String(await command("enable global", ctx))).toContain("enabled (global settings:");
    expect(statuses["reasoning-zip"]).toBe("🗜️ Zip");
    expect(notifications.at(-1)).toContain("enabled");
  });

  it("footer status follows resolved enabled setting and global label on session lifecycle", async () => {
    const enabledCwd = await tempProject({ enabled: true });
    const disabledCwd = await tempProject({ enabled: false });
    process.env.PI_CODING_AGENT_DIR = join(enabledCwd, "agent");
    await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });
    await writeFile(join(process.env.PI_CODING_AGENT_DIR, "settings.json"), JSON.stringify({ reasoningZip: { footerStatus: "Zip On" } }), "utf8");
    const handlers = loadExtensionSurface().handlers;
    const statuses: Record<string, string | undefined> = {};
    const ctx = (cwd: string) => ({ cwd, ui: { setStatus: (key: string, value: string | undefined) => { statuses[key] = value; } } });

    handlers.get("session_start")?.({}, ctx(enabledCwd));
    expect(statuses["reasoning-zip"]).toBe("Zip On");
    handlers.get("session_start")?.({}, ctx(disabledCwd));
    expect(statuses["reasoning-zip"]).toBeUndefined();
    handlers.get("session_shutdown")?.({}, ctx(enabledCwd));
    expect(statuses["reasoning-zip"]).toBeUndefined();
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
