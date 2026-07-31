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

async function writeGlobalSettings(cwd: string, settings: unknown): Promise<void> {
  process.env.PI_CODING_AGENT_DIR = join(cwd, "agent");
  await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });
  await writeFile(join(process.env.PI_CODING_AGENT_DIR, "settings.json"), JSON.stringify({ reasoningZip: settings }), "utf8");
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
    const enabledCwd = await tempProject({ enabled: true, footerStatus: "Project Zip" });
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
    const cwd = await tempProject({ enabled: true, mode: "all", thresholds: { minChars: 5, maxTraceChars: 100 } });
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

  it("message_end warns when compaction fails and preserves the original message", async () => {
    const cwd = await tempProject({ enabled: true, mode: "all", thresholds: { minChars: 5, maxTraceChars: 100 } });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 500 } as Response);
    const handler = loadExtension().get("message_end")!;
    const notifications: Array<{ message: string; level: string | undefined }> = [];
    const message = { role: "assistant", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] };

    const result = await handler(
      { message },
      { cwd, ui: { notify: (notification: string, level?: string) => notifications.push({ message: notification, level }) } },
    );

    expect(result).toBeUndefined();
    expect(notifications).toEqual([
      { message: "pi-reasoning-zip compaction failed; original reasoning was preserved.", level: "warning" },
    ]);
  });

  it("message_end recursively inherits global compactor and threshold settings", async () => {
    const cwd = await tempProject({ mode: "all", thresholds: { minChars: 5 } });
    await writeGlobalSettings(cwd, {
      compactor: { baseUrl: "http://global.test/v1", model: "global-model", maxTokens: 77 },
      thresholds: { minChars: 1000, maxTraceChars: 2 },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "zip" } }] }),
    } as Response);
    const handler = loadExtension().get("message_end")!;

    const result = await handler(
      { message: { role: "assistant", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] } },
      { cwd },
    );

    expect(result).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("http://global.test/v1/chat/completions", expect.anything());
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { model: string; max_tokens: number };
    expect(body.model).toBe("global-model");
    expect(body.max_tokens).toBe(77);
  });

  it("message_end applies nested project overrides while inheriting sibling global settings", async () => {
    const cwd = await tempProject({
      mode: "all",
      compactor: { model: "project-model" },
      thresholds: { maxTraceChars: 12 },
    });
    await writeGlobalSettings(cwd, {
      compactor: { baseUrl: "http://global.test/v1", model: "global-model", maxTokens: 77 },
      thresholds: { minChars: 5, maxTraceChars: 5 },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "project zip" } }] }),
    } as Response);
    const handler = loadExtension().get("message_end")!;

    const result = await handler(
      { message: { role: "assistant", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] } },
      { cwd },
    );

    expect(result.message.content[0].thinking).toBe("project zip");
    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body)) as { model: string; max_tokens: number };
    expect(url).toBe("http://global.test/v1/chat/completions");
    expect(body.model).toBe("project-model");
    expect(body.max_tokens).toBe(77);
  });

  it("message_end returns undefined when unchanged", async () => {
    const cwd = await tempProject({ mode: "all", thresholds: { minChars: 1000 } });
    const handler = loadExtension().get("message_end")!;
    const result = await handler({ message: { role: "assistant", content: [{ type: "thinking", thinking: "short" }] } }, { cwd });
    expect(result).toBeUndefined();
  });

  it("before_provider_request injects only for changed payloads", async () => {
    const cwd = await tempProject({ enabled: true, mode: "llama-only" });
    const handler = loadExtension().get("before_provider_request")!;
    const injected = await handler({ provider: "llama-server=http://127.0.0.1:7484", payload: { messages: [{ role: "system", content: "sys" }] } }, { cwd });
    expect(injected.messages[0].content).toContain(PROMPT_MARKER);

    const skipped = await handler({ provider: "openai", payload: { messages: [{ role: "system", content: "sys" }] } }, { cwd });
    expect(skipped).toBeUndefined();
  });

  it("before_provider_request pins main llama.cpp requests without overriding explicit id_slot", async () => {
    const cwd = await tempProject({ enabled: true, mode: "llama-only", injectPrompt: false, llamaCppSlots: { enabled: true, mainIdSlot: 0, compactorIdSlot: 1 } });
    const handler = loadExtension().get("before_provider_request")!;

    const pinned = await handler(
      { provider: "llama-server=http://127.0.0.1:7484", payload: { messages: [{ role: "system", content: "sys" }] } },
      { cwd },
    );
    expect(pinned.id_slot).toBe(0);
    expect(pinned.cache_prompt).toBe(true);

    const explicit = await handler(
      { provider: "llama-server=http://127.0.0.1:7484", payload: { id_slot: 7, messages: [{ role: "system", content: "sys" }] } },
      { cwd },
    );
    expect(explicit).toBeUndefined();
  });

  it("forced slot pinning does not add llama.cpp fields to non-llama providers", async () => {
    const cwd = await tempProject({ enabled: true, mode: "all", injectPrompt: false, llamaCppSlots: { enabled: true, mainIdSlot: 0, compactorIdSlot: 1 }, thresholds: { minChars: 5, maxTraceChars: 100 } });
    const handlers = loadExtension();
    const provider = "openai";

    const requestResult = await handlers.get("before_provider_request")!(
      { provider, payload: { messages: [{ role: "system", content: "sys" }] } },
      { cwd },
    );
    expect(requestResult).toBeUndefined();

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "zip" } }] }),
    } as Response);
    await handlers.get("message_end")!(
      { message: { role: "assistant", provider, content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] } },
      { cwd },
    );
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.id_slot).toBeUndefined();
    expect(body.cache_prompt).toBeUndefined();
  });

  it("before_provider_request auto-pins when the shared llama.cpp server exposes at least two slots", async () => {
    const cwd = await tempProject({
      enabled: true,
      mode: "llama-only",
      injectPrompt: false,
      llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 },
      thresholds: { minChars: 5, maxTraceChars: 100 },
    });
    const handlers = loadExtension();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 0 }, { id: 1 }] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: "zip" } }] }) } as Response);

    const pinned = await handlers.get("before_provider_request")!(
      { provider: "llama-server=http://127.0.0.1:7484", payload: { messages: [{ role: "system", content: "sys" }] } },
      { cwd },
    );
    expect(pinned.id_slot).toBe(0);

    const result = await handlers.get("message_end")!(
      { message: { role: "assistant", provider: "llama-server=http://127.0.0.1:7484", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] } },
      { cwd },
    );
    expect(result.message.content[0].thinking).toBe("zip");
    const compactorBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(compactorBody.id_slot).toBe(1);
  });

  it("before_provider_request auto-pins custom OpenAI-compatible llama.cpp models when /slots works", async () => {
    const cwd = await tempProject({ enabled: true, mode: "all", injectPrompt: false, llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 }, compactor: { baseUrl: "http://127.0.0.1:7487/v1" } });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: true, json: async () => [{ id: 0 }, { id: 1 }] } as Response);
    const handler = loadExtension().get("before_provider_request")!;

    const result = await handler(
      { provider: "custom-local", payload: { messages: [{ role: "system", content: "sys" }] } },
      { cwd, model: { provider: "custom-local", baseUrl: "http://127.0.0.1:7487/v1" } },
    );

    expect(result.id_slot).toBe(0);
  });

  it("before_provider_request does not auto-pin same-origin but different-path llama.cpp servers", async () => {
    const cwd = await tempProject({ enabled: true, mode: "llama-only", injectPrompt: false, llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 }, compactor: { baseUrl: "http://127.0.0.1:7488/zip/v1" } });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const handler = loadExtension().get("before_provider_request")!;

    const result = await handler(
      { provider: "llama-server=http://127.0.0.1:7488/main/v1", payload: { messages: [{ role: "system", content: "sys" }] } },
      { cwd },
    );

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("before_provider_request reuses the auto slot probe result", async () => {
    const cwd = await tempProject({ enabled: true, mode: "llama-only", injectPrompt: false, llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 }, compactor: { baseUrl: "http://127.0.0.1:7486/v1" } });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: true, json: async () => [{ id: 0 }, { id: 1 }] } as Response);
    const handler = loadExtension().get("before_provider_request")!;
    const event = { provider: "llama-server=http://127.0.0.1:7486", payload: { messages: [{ role: "system", content: "sys" }] } };

    await handler(event, { cwd });
    await handler(event, { cwd });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("before_provider_request does not auto-pin when the shared llama.cpp server has fewer than two slots", async () => {
    const cwd = await tempProject({ enabled: true, mode: "llama-only", injectPrompt: false, llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 }, compactor: { baseUrl: "http://127.0.0.1:7485/v1" } });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: true, json: async () => [{ id: 0 }] } as Response);
    const handler = loadExtension().get("before_provider_request")!;

    const result = await handler(
      { provider: "llama-server=http://127.0.0.1:7485", payload: { messages: [{ role: "system", content: "sys" }] } },
      { cwd },
    );

    expect(result).toBeUndefined();
  });

  it("before_provider_request warns when an explicit main id_slot conflicts with compactor id_slot", async () => {
    const cwd = await tempProject({ enabled: true, mode: "llama-only", injectPrompt: false, llamaCppSlots: { enabled: true, mainIdSlot: 0, compactorIdSlot: 1 } });
    const handlers = loadExtension();
    const handler = handlers.get("before_provider_request")!;
    const notifications: Array<{ message: string; level: string | undefined }> = [];

    const result = await handler(
      { provider: "llama-server=http://127.0.0.1:7484", payload: { id_slot: 1, messages: [{ role: "system", content: "sys" }] } },
      { cwd, ui: { notify: (message: string, level?: string) => notifications.push({ message, level }) } },
    );

    expect(result).toBeUndefined();
    expect(notifications).toEqual([
      { message: "pi-reasoning-zip llama.cpp id_slot conflict; main and compactor slots should differ; compaction is disabled for this provider until reload.", level: "warning" },
    ]);

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "zip" } }] }),
    } as Response);
    const messageEnd = handlers.get("message_end")!;
    const messageEndResult = await messageEnd(
      { message: { role: "assistant", provider: "llama-server=http://127.0.0.1:7484", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] } },
      { cwd },
    );
    expect(messageEndResult).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("before_provider_request can target the real Pi ctx.model provider shape", async () => {
    const cwd = await tempProject({ enabled: true, mode: "llama-only" });
    const handler = loadExtension().get("before_provider_request")!;
    const injected = await handler(
      { type: "before_provider_request", payload: { messages: [{ role: "system", content: "sys" }] } },
      { cwd, model: { provider: "llama-server=http://127.0.0.1:7484" } },
    );
    expect(injected.messages[0].content).toContain(PROMPT_MARKER);
  });

  it("ignores a malformed project section and keeps valid global settings", async () => {
    const cwd = await tempProject("invalid");
    await writeGlobalSettings(cwd, { mode: "all" });
    const handler = loadExtension().get("before_provider_request")!;

    const injected = await handler(
      { provider: "openai", payload: { messages: [{ role: "system", content: "sys" }] } },
      { cwd },
    );

    expect(injected.messages[0].content).toContain(PROMPT_MARKER);
  });
});
