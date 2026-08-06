import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import reasoningZipExtension from "../src/index.js";

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

beforeEach(async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "reasoning-zip-agent-"));
  tempDirs.push(agentDir);
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

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
    expect(String(await command("", ctx))).toContain("disabled (project settings:");
    expect(statuses["reasoning-zip"]).toBeUndefined();
    expect(String(await command(undefined, ctx))).toContain("enabled (project settings:");
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
      compactor: { baseUrl: "http://global.test/v1", model: "global-model", maxCompactionRatio: 0.5 },
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
    const request = fetchMock.mock.calls.find(([url]) => url === "http://global.test/v1/chat/completions")?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { model: string; max_tokens: number };
    expect(body.model).toBe("global-model");
    expect(body.max_tokens).toBe(5);
  });

  it("message_end applies nested project overrides while inheriting sibling global settings", async () => {
    const cwd = await tempProject({
      mode: "all",
      compactor: { model: "project-model" },
      thresholds: { maxTraceChars: 12 },
    });
    await writeGlobalSettings(cwd, {
      compactor: { baseUrl: "http://global.test/v1", model: "global-model", maxCompactionRatio: 0.5 },
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
    const [, init] = fetchMock.mock.calls.find(([url]) => url === "http://global.test/v1/chat/completions")!;
    const body = JSON.parse(String((init as RequestInit).body)) as { model: string; max_tokens: number };
    expect(body.model).toBe("project-model");
    expect(body.max_tokens).toBe(5);
  });

  it("message_end returns undefined when unchanged", async () => {
    const cwd = await tempProject({ mode: "all", thresholds: { minChars: 1000 } });
    const handler = loadExtension().get("message_end")!;
    const result = await handler({ message: { role: "assistant", content: [{ type: "thinking", thinking: "short" }] } }, { cwd });
    expect(result).toBeUndefined();
  });

  it("never changes the main-model prompt when slot pinning is disabled", async () => {
    const cwd = await tempProject({ enabled: true, mode: "llama-only", llamaCppSlots: { enabled: false } });
    const handler = loadExtension().get("before_provider_request")!;
    const payload = { messages: [{ role: "system", content: "keep this exact" }, { role: "user", content: "hello" }] };

    const result = await handler(
      { provider: "llama-server=http://127.0.0.1:7484", payload },
      { cwd },
    );

    expect(result).toBeUndefined();
    expect(payload.messages[0].content).toBe("keep this exact");
  });

  it("before_provider_request pins main llama.cpp requests without overriding explicit id_slot", async () => {
    const cwd = await tempProject({ enabled: true, mode: "llama-only", llamaCppSlots: { enabled: true, mainIdSlot: 0, compactorIdSlot: 1 } });
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
    const cwd = await tempProject({ enabled: true, mode: "all", llamaCppSlots: { enabled: true, mainIdSlot: 0, compactorIdSlot: 1 }, thresholds: { minChars: 5, maxTraceChars: 100 } });
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
      llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 },
      compactor: { apiKey: "slot-secret" },
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
    expect(pinned.cache_prompt).toBe(true);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({ authorization: "Bearer slot-secret" });

    const result = await handlers.get("message_end")!(
      { message: { role: "assistant", provider: "llama-server=http://127.0.0.1:7484", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] } },
      { cwd },
    );
    expect(result.message.content[0].thinking).toBe("zip");
    const compactorBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(compactorBody.id_slot).toBe(1);
  });

  it("before_provider_request auto-pins custom OpenAI-compatible llama.cpp models when /slots works", async () => {
    const cwd = await tempProject({ enabled: true, mode: "all", llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 }, compactor: { baseUrl: "http://127.0.0.1:7487/v1" } });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: true, json: async () => [{ id: 0 }, { id: 1 }] } as Response);
    const handler = loadExtension().get("before_provider_request")!;

    const result = await handler(
      { provider: "custom-local", payload: { messages: [{ role: "system", content: "sys" }] } },
      { cwd, model: { provider: "custom-local", baseUrl: "http://127.0.0.1:7487/v1" } },
    );

    expect(result.id_slot).toBe(0);
  });

  it("before_provider_request does not auto-pin same-origin but different-path llama.cpp servers", async () => {
    const cwd = await tempProject({ enabled: true, mode: "llama-only", llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 }, compactor: { baseUrl: "http://127.0.0.1:7488/zip/v1" } });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const handler = loadExtension().get("before_provider_request")!;

    const result = await handler(
      { provider: "llama-server=http://127.0.0.1:7488/main/v1", payload: { messages: [{ role: "system", content: "sys" }] } },
      { cwd },
    );

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("before_provider_request deduplicates concurrent auto slot probes", async () => {
    const cwd = await tempProject({ enabled: true, mode: "llama-only", llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 }, compactor: { baseUrl: "http://127.0.0.1:7486/v1" } });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: true, json: async () => [{ id: 0 }, { id: 1 }] } as Response);
    const handler = loadExtension().get("before_provider_request")!;
    const event = { provider: "llama-server=http://127.0.0.1:7486", payload: { messages: [{ role: "system", content: "sys" }] } };

    await Promise.all([handler(event, { cwd }), handler(event, { cwd })]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("before_provider_request does not auto-pin when the shared llama.cpp server has fewer than two slots", async () => {
    const cwd = await tempProject({ enabled: true, mode: "llama-only", llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 }, compactor: { baseUrl: "http://127.0.0.1:7485/v1" } });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: true, json: async () => [{ id: 0 }] } as Response);
    const handler = loadExtension().get("before_provider_request")!;

    const result = await handler(
      { provider: "llama-server=http://127.0.0.1:7485", payload: { messages: [{ role: "system", content: "sys" }] } },
      { cwd },
    );

    expect(result).toBeUndefined();
  });

  it("disabled auto mode does not probe or warn", async () => {
    const cwd = await tempProject({
      enabled: false,
      mode: "llama-only",
      llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 },
      compactor: { baseUrl: "http://127.0.0.1:7489/v1" },
      thresholds: { minChars: 5 },
    });
    const handlers = loadExtension();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const notifications: string[] = [];
    const ctx = { cwd, ui: { notify: (message: string) => notifications.push(message) } };

    await handlers.get("before_provider_request")!(
      { provider: "llama-server=http://127.0.0.1:7489", payload: { messages: [] } },
      ctx,
    );
    await handlers.get("message_end")!(
      { message: { role: "assistant", provider: "llama-server=http://127.0.0.1:7489", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] } },
      ctx,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(notifications).toEqual([]);
  });

  it("enabling auto mode during a generation fails closed", async () => {
    const cwd = await tempProject({
      enabled: false,
      mode: "llama-only",
      llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 },
      compactor: { baseUrl: "http://127.0.0.1:7489/v1" },
      thresholds: { minChars: 5 },
    });
    const handlers = loadExtension();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const notifications: Array<{ message: string; level: string | undefined }> = [];
    const ctx = { cwd, ui: { notify: (message: string, level?: string) => notifications.push({ message, level }) } };

    await handlers.get("before_provider_request")!(
      { provider: "llama-server=http://127.0.0.1:7489", payload: { messages: [] } },
      ctx,
    );
    await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ reasoningZip: {
      enabled: true,
      mode: "llama-only",
      llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 },
      compactor: { baseUrl: "http://127.0.0.1:7489/v1" },
      thresholds: { minChars: 5 },
    } }), "utf8");

    const result = await handlers.get("message_end")!(
      { message: { role: "assistant", provider: "llama-server=http://127.0.0.1:7489", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] } },
      ctx,
    );

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(notifications).toEqual([
      { message: "pi-reasoning-zip slot settings changed during generation; original reasoning preserved.", level: "warning" },
    ]);
  });

  it("auto mode without a matching main-request decision fails closed", async () => {
    const cwd = await tempProject({
      enabled: true,
      mode: "llama-only",
      llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 },
      compactor: { baseUrl: "http://127.0.0.1:7489/v1" },
      thresholds: { minChars: 5 },
    });
    const handlers = loadExtension();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const notifications: Array<{ message: string; level: string | undefined }> = [];

    const result = await handlers.get("message_end")!(
      { message: { role: "assistant", provider: "llama-server=http://127.0.0.1:7489", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] } },
      { cwd, ui: { notify: (message: string, level?: string) => notifications.push({ message, level }) } },
    );

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(notifications).toEqual([
      { message: "pi-reasoning-zip cannot verify slot isolation for this response; original reasoning preserved.", level: "warning" },
    ]);
  });

  it("auto mode with an unknown main endpoint and no request decision fails closed", async () => {
    const cwd = await tempProject({
      enabled: true,
      mode: "llama-only",
      llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 },
      compactor: { baseUrl: "http://127.0.0.1:7489/v1" },
      thresholds: { minChars: 5 },
    });
    const handlers = loadExtension();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const notifications: string[] = [];

    const result = await handlers.get("message_end")!(
      { message: { role: "assistant", provider: "llamacpp", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] } },
      { cwd, ui: { notify: (message: string) => notifications.push(message) } },
    );

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(notifications).toEqual([
      "pi-reasoning-zip cannot verify slot isolation for this response; original reasoning preserved.",
    ]);
  });

  it("auto mode with an unknown main endpoint fails closed through the normal lifecycle", async () => {
    const cwd = await tempProject({
      enabled: true,
      mode: "llama-only",
      llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 },
      compactor: { baseUrl: "http://127.0.0.1:7489/v1" },
      thresholds: { minChars: 5 },
    });
    const handlers = loadExtension();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const notifications: string[] = [];
    const ctx = { cwd, ui: { notify: (message: string) => notifications.push(message) } };

    await handlers.get("before_provider_request")!(
      { provider: "llamacpp", payload: { messages: [] } },
      ctx,
    );
    const result = await handlers.get("message_end")!(
      { message: { role: "assistant", provider: "llamacpp", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] } },
      ctx,
    );

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(notifications).toEqual([
      "pi-reasoning-zip safe llama.cpp slot isolation is unavailable; original reasoning preserved.",
    ]);
  });

  it("overlapping same-provider requests both fail closed", async () => {
    const cwd = await tempProject({
      enabled: true,
      mode: "llama-only",
      llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 },
      compactor: { baseUrl: "http://127.0.0.1:7489/v1" },
      thresholds: { minChars: 5 },
    });
    const handlers = loadExtension();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: true, json: async () => [{ id: 0 }, { id: 1 }] } as Response);
    const notifications: string[] = [];
    const ctx = { cwd, ui: { notify: (message: string) => notifications.push(message) } };
    const provider = "llama-server=http://127.0.0.1:7489";

    await Promise.all([
      handlers.get("before_provider_request")!({ provider, payload: { messages: [] } }, ctx),
      handlers.get("before_provider_request")!({ provider, payload: { messages: [] } }, ctx),
    ]);
    const message = { role: "assistant", provider, content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] };
    expect(await handlers.get("message_end")!({ message }, ctx)).toBeUndefined();
    expect(await handlers.get("message_end")!({ message }, ctx)).toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(notifications).toEqual([
      "pi-reasoning-zip overlapping provider requests cannot be correlated safely; original reasoning preserved.",
      "pi-reasoning-zip cannot verify slot isolation for this response; original reasoning preserved.",
    ]);
  });

  it("recovers after an abandoned provider request", async () => {
    const cwd = await tempProject({
      enabled: true,
      mode: "llama-only",
      llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 },
      compactor: { baseUrl: "http://127.0.0.1:7489/v1" },
      thresholds: { minChars: 5, maxTraceChars: 100 },
    });
    const handlers = loadExtension();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 0 }, { id: 1 }] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: "unsloth", meta: { n_ctx: 53504 } }] }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: "zip" } }] }) } as Response);
    const notifications: string[] = [];
    const notify = (message: string) => notifications.push(message);
    const abandonedCtx = { cwd, signal: new AbortController().signal, ui: { notify } };
    const nextCtx = { cwd, signal: new AbortController().signal, ui: { notify } };
    const provider = "llama-server=http://127.0.0.1:7489";
    const request = { provider, payload: { messages: [] } };
    const message = { role: "assistant", provider, content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] };

    await handlers.get("before_provider_request")!(request, abandonedCtx); // abandoned: no message_end or abort
    await handlers.get("before_provider_request")!(request, nextCtx);
    const recovered = await handlers.get("message_end")!({ message }, nextCtx);

    expect(recovered.message.content[0].thinking).toBe("zip");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(notifications).toEqual([]);
  });

  it("before_provider_request warns when an explicit main id_slot conflicts with compactor id_slot", async () => {
    const cwd = await tempProject({ enabled: true, mode: "llama-only", llamaCppSlots: { enabled: true, mainIdSlot: 0, compactorIdSlot: 1 } });
    const handlers = loadExtension();
    const handler = handlers.get("before_provider_request")!;
    const notifications: Array<{ message: string; level: string | undefined }> = [];

    const result = await handler(
      { provider: "llama-server=http://127.0.0.1:7484", payload: { id_slot: 1, messages: [{ role: "system", content: "sys" }] } },
      { cwd, ui: { notify: (message: string, level?: string) => notifications.push({ message, level }) } },
    );

    expect(result).toBeUndefined();
    expect(notifications).toEqual([
      { message: "pi-reasoning-zip llama.cpp id_slot conflict; original reasoning for this response will be preserved.", level: "warning" },
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

  it("before_provider_request can pin the real Pi ctx.model provider shape", async () => {
    const cwd = await tempProject({ enabled: true, mode: "llama-only", llamaCppSlots: { enabled: true, mainIdSlot: 3, compactorIdSlot: 4 } });
    const handler = loadExtension().get("before_provider_request")!;
    const pinned = await handler(
      { type: "before_provider_request", payload: { messages: [{ role: "system", content: "sys" }] } },
      { cwd, model: { id: "main-model", provider: "llama-server=http://127.0.0.1:7484" } },
    );
    expect(pinned.id_slot).toBe(3);
    expect(pinned.messages[0].content).toBe("sys");
  });

  it("leaves requests for a different model untouched when Pi omits request provider attribution", async () => {
    const cwd = await tempProject({ enabled: true, mode: "all", llamaCppSlots: { enabled: "auto" } });
    const handler = loadExtension().get("before_provider_request")!;
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await handler(
      { type: "before_provider_request", payload: { model: "compaction-model", messages: [{ role: "system", content: "sys" }] } },
      { cwd, model: { id: "main-model", provider: "llama-server=http://127.0.0.1:7484", baseUrl: "http://127.0.0.1:7484/v1" } },
    );

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves explicitly modeled requests untouched when context model attribution is unavailable", async () => {
    const cwd = await tempProject({ enabled: true, mode: "all" });
    const handler = loadExtension().get("before_provider_request")!;

    const result = await handler(
      { type: "before_provider_request", payload: { model: "request-model", messages: [{ role: "system", content: "sys" }] } },
      { cwd },
    );

    expect(result).toBeUndefined();
  });

  it("clears slot state when Pi aborts a provider request", async () => {
    const cwd = await tempProject({ enabled: true, mode: "llama-only", llamaCppSlots: { enabled: true, mainIdSlot: 0, compactorIdSlot: 1 }, thresholds: { minChars: 5, maxTraceChars: 100 } });
    const handlers = loadExtension();
    const controller = new AbortController();
    const request = { provider: "llama-server=http://127.0.0.1:7484", payload: { messages: [{ role: "system", content: "sys" }] } };
    const ctx = { cwd, signal: controller.signal };

    await handlers.get("before_provider_request")!(request, ctx);
    controller.abort();

    const nextController = new AbortController();
    await handlers.get("before_provider_request")!(request, { cwd, signal: nextController.signal });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "zip" } }] }),
    } as Response);
    const result = await handlers.get("message_end")!(
      { message: { role: "assistant", provider: "llama-server=http://127.0.0.1:7484", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] } },
      { cwd },
    );

    expect(result.message.content[0].thinking).toBe("zip");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores a malformed project section and keeps valid global settings", async () => {
    const cwd = await tempProject("invalid");
    await writeGlobalSettings(cwd, { mode: "all", thresholds: { minChars: 5, maxTraceChars: 100 } });
    const handler = loadExtension().get("message_end")!;
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "zip" } }] }),
    } as Response);

    const result = await handler(
      { message: { role: "assistant", provider: "openai", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] } },
      { cwd },
    );

    expect(result.message.content[0].thinking).toBe("zip");
  });

  // ---- cache-isolation hardening tests ----

  it("auto mode: probe failure causes no compactor call and warns", async () => {
    const cwd = await tempProject({
      enabled: true,
      mode: "llama-only",
      llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 },
      compactor: { baseUrl: "http://127.0.0.1:7490/v1" },
      thresholds: { minChars: 5, maxTraceChars: 100 },
    });
    const handlers = loadExtension();
    const notifications: Array<{ message: string; level: string | undefined }> = [];
    // Probe fails (network error).
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network error"));

    const ctx = { cwd, ui: { notify: (message: string, level?: string) => notifications.push({ message, level }) } };
    await handlers.get("before_provider_request")!(
      { provider: "llama-server=http://127.0.0.1:7490", payload: { messages: [{ role: "system", content: "sys" }] } },
      ctx,
    );

    // message_end should NOT call the compactor and should warn.
    const result = await handlers.get("message_end")!(
      { message: { role: "assistant", provider: "llama-server=http://127.0.0.1:7490", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] } },
      ctx,
    );

    expect(result).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(notifications).toEqual([
      { message: "pi-reasoning-zip safe llama.cpp slot isolation is unavailable; original reasoning preserved.", level: "warning" },
    ]);
  });

  it("auto mode: one slot causes no compactor call and warns", async () => {
    const cwd = await tempProject({
      enabled: true,
      mode: "llama-only",
      llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 },
      compactor: { baseUrl: "http://127.0.0.1:7491/v1" },
      thresholds: { minChars: 5, maxTraceChars: 100 },
    });
    const handlers = loadExtension();
    const notifications: Array<{ message: string; level: string | undefined }> = [];
    // Probe returns only one slot.
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: true, json: async () => [{ id: 0 }] } as Response);

    const ctx = { cwd, ui: { notify: (message: string, level?: string) => notifications.push({ message, level }) } };
    await handlers.get("before_provider_request")!(
      { provider: "llama-server=http://127.0.0.1:7491", payload: { messages: [{ role: "system", content: "sys" }] } },
      ctx,
    );

    const result = await handlers.get("message_end")!(
      { message: { role: "assistant", provider: "llama-server=http://127.0.0.1:7491", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] } },
      ctx,
    );

    expect(result).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(notifications).toEqual([
      { message: "pi-reasoning-zip safe llama.cpp slot isolation is unavailable; original reasoning preserved.", level: "warning" },
    ]);
  });

  it("auto mode: 2 slots with configured main=0/compactor=2 causes no compactor call (modulo collision)", async () => {
    const cwd = await tempProject({
      enabled: true,
      mode: "llama-only",
      llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 2 },
      compactor: { baseUrl: "http://127.0.0.1:7492/v1" },
      thresholds: { minChars: 5, maxTraceChars: 100 },
    });
    const handlers = loadExtension();
    const notifications: Array<{ message: string; level: string | undefined }> = [];
    // Probe returns 2 slots — 0 and 2 collide modulo 2.
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: true, json: async () => [{ id: 0 }, { id: 1 }] } as Response);

    const ctx = { cwd, ui: { notify: (message: string, level?: string) => notifications.push({ message, level }) } };
    await handlers.get("before_provider_request")!(
      { provider: "llama-server=http://127.0.0.1:7492", payload: { messages: [{ role: "system", content: "sys" }] } },
      ctx,
    );

    const result = await handlers.get("message_end")!(
      { message: { role: "assistant", provider: "llama-server=http://127.0.0.1:7492", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] } },
      ctx,
    );

    expect(result).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(notifications).toEqual([
      { message: "pi-reasoning-zip safe llama.cpp slot isolation is unavailable; original reasoning preserved.", level: "warning" },
    ]);
  });

  it("auto mode: explicit main id_slot modulo-conflict disables compaction", async () => {
    const cwd = await tempProject({
      enabled: true,
      mode: "llama-only",
      llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 2 },
      compactor: { baseUrl: "http://127.0.0.1:7493/v1" },
      thresholds: { minChars: 5, maxTraceChars: 100 },
    });
    const handlers = loadExtension();
    const notifications: Array<{ message: string; level: string | undefined }> = [];
    // 3 slots — configured main=0 and compactor=2 don't collide (0%3=0, 2%3=2).
    // But explicit id_slot=5 collides with compactorIdSlot=2 modulo 3 (5%3=2, 2%3=2).
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: true, json: async () => [{ id: 0 }, { id: 1 }, { id: 2 }] } as Response);

    const ctx = { cwd, ui: { notify: (message: string, level?: string) => notifications.push({ message, level }) } };
    const result = await handlers.get("before_provider_request")!(
      { provider: "llama-server=http://127.0.0.1:7493", payload: { id_slot: 5, messages: [{ role: "system", content: "sys" }] } },
      ctx,
    );

    expect(result).toBeUndefined();
    expect(notifications).toEqual([
      { message: "pi-reasoning-zip llama.cpp id_slot conflict; original reasoning for this response will be preserved.", level: "warning" },
    ]);

    const messageEndResult = await handlers.get("message_end")!(
      { message: { role: "assistant", provider: "llama-server=http://127.0.0.1:7493", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] } },
      ctx,
    );
    expect(messageEndResult).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("auto mode: settings changed during generation fail closed", async () => {
    const cwd = await tempProject({
      enabled: true,
      mode: "llama-only",
      llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 },
      compactor: { baseUrl: "http://127.0.0.1:7495/v1" },
      thresholds: { minChars: 5, maxTraceChars: 100 },
    });
    const handlers = loadExtension();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: true, json: async () => [{ id: 0 }, { id: 1 }] } as Response);
    const notifications: Array<{ message: string; level: string | undefined }> = [];
    const ctx = { cwd, ui: { notify: (message: string, level?: string) => notifications.push({ message, level }) } };

    await handlers.get("before_provider_request")!(
      { provider: "llama-server=http://127.0.0.1:7495", payload: { messages: [] } },
      ctx,
    );
    await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ reasoningZip: {
      enabled: true,
      mode: "llama-only",
      llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 0 },
      compactor: { baseUrl: "http://127.0.0.1:7495/v1" },
      thresholds: { minChars: 5, maxTraceChars: 100 },
    } }), "utf8");

    const result = await handlers.get("message_end")!(
      { message: { role: "assistant", provider: "llama-server=http://127.0.0.1:7495", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] } },
      ctx,
    );

    expect(result).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(notifications).toEqual([
      { message: "pi-reasoning-zip slot settings changed during generation; original reasoning preserved.", level: "warning" },
    ]);
  });

  it("auto mode: message_end uses the decision from its main request without re-probing", async () => {
    const cwd = await tempProject({
      enabled: true,
      mode: "llama-only",
      llamaCppSlots: { enabled: "auto", mainIdSlot: 0, compactorIdSlot: 1 },
      compactor: { baseUrl: "http://127.0.0.1:7494/v1" },
      thresholds: { minChars: 5, maxTraceChars: 100 },
    });
    const handlers = loadExtension();
    const notifications: Array<{ message: string; level: string | undefined }> = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 0 }, { id: 1 }, { id: 2 }] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: "unsloth", meta: { n_ctx: 53504 } }] }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: "zip" } }] }) } as Response);

    // before_provider_request probes and pins.
    await handlers.get("before_provider_request")!(
      { provider: "llama-server=http://127.0.0.1:7494", payload: { messages: [{ role: "system", content: "sys" }] } },
      { cwd },
    );

    // message_end must use the decision that governed the actual main request.
    const result = await handlers.get("message_end")!(
      { message: { role: "assistant", provider: "llama-server=http://127.0.0.1:7494", content: [{ type: "thinking", thinking: "abcdefghijklmnopqrstuvwxyz" }] } },
      { cwd, ui: { notify: (message: string, level?: string) => notifications.push({ message, level }) } },
    );

    expect(result.message.content[0].thinking).toBe("zip");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(notifications).toEqual([]);
  });
});
