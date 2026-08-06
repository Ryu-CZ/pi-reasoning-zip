#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { buildCompactionPrompt } from "../dist/compactPrompt.js";

const endpoint = process.env.COMPACTOR_BASE_URL ?? "http://127.0.0.1:7484/v1";
const model = process.env.COMPACTOR_MODEL ?? "unsloth";
const mainSlot = Number(process.env.MAIN_SLOT ?? 0);
const compactorSlot = Number(process.env.COMPACTOR_SLOT ?? 1);
const thinkingBudget = Number(process.env.THINKING_BUDGET ?? 8192);
const mainMaxTokens = Number(process.env.MAIN_MAX_TOKENS ?? 10000);
const maxTraceChars = Number(process.env.MAX_TRACE_CHARS ?? -1);
const outputPath = resolve(process.argv[2] ?? "benchmarks/high-reasoning/results.json");

const cases = [
  {
    id: "release-recovery",
    mustRetain: ["payments-api", "v4.17.3", "v4.18.0", "20260806_add_capture_key", "7.8%", "./ops/check-protobuf-compat.sh v4.17.3 v4.18.0"],
    prompt: "A deploy changed payments-api from v4.17.3 to v4.18.0. Error rate rose from 0.3% to 7.8% after migration 20260806_add_capture_key. Rolling pods back alone leaves schema mismatch. Deleting capture_key is unsafe while v4.18.0 writers exist. Diagnose the safest recovery plan, compare alternatives, include a verification gate, a rollback condition, and the exact first command `./ops/check-protobuf-compat.sh v4.17.3 v4.18.0`. Do not execute commands.",
  },
  {
    id: "idempotency-repair",
    mustRetain: ["req_01J4Q9H8M2", "7 s", "30 s", "FIN-482", "SQLSTATE 23505", "/opt/billing/bin/audit-idem"],
    prompt: "Investigate a duplicate payment: request req_01J4Q9H8M2 charged $48.20 at 09:41:12Z and again at 09:41:19Z. Redis idempotency TTL is 30 s, so expiry cannot explain the 7 s retry. A process-local mutex failed across pods. Finance ticket FIN-482 is required before refunds. Evaluate recovery and prevention alternatives under a 50 ms maximum table-lock constraint. State uncertainties, rejection reasons, rollback, success criteria, and the exact first command `/opt/billing/bin/audit-idem --since 2026-07-01 --format json > /tmp/idem-audit.json`. Do not execute commands.",
  },
  {
    id: "parser-release",
    mustRetain: ["6.3.1", "12 files", "8 MiB", "RangeError", "optional: true", "10,000 iterations"],
    prompt: "Decide whether to ship parser version 6.3.1. Nested includes allow at most 12 files and 8 MiB expanded input. Raw-string cycle tracking missed ./a.yaml -> sub/../a.yaml and caused RangeError: Maximum call stack size exceeded. Using realpath everywhere broke dry runs for an absent include marked optional: true. Work through a safe implementation, rejected alternatives and their reconsideration conditions, rollback, abort conditions, uncertainty, and a release gate requiring a symlink-race test over 10,000 iterations. Do not execute commands.",
  },
];

function includes(text, value) {
  return text.toLocaleLowerCase("en-US").includes(value.toLocaleLowerCase("en-US"));
}

async function request(body) {
  const started = performance.now();
  const response = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer sk-placeholder" },
    body: JSON.stringify(body),
  });
  const latencyMs = Math.round(performance.now() - started);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const json = await response.json();
  return { json, latencyMs, finishReason: json.choices?.[0]?.finish_reason ?? null };
}

const records = [];
for (const testCase of cases) {
  process.stdout.write(`${testCase.id}: generate ... `);
  try {
    const generated = await request({
      model,
      id_slot: mainSlot,
      seed: 3407,
      temperature: 0.1,
      max_tokens: mainMaxTokens,
      thinking_budget_tokens: thinkingBudget,
      chat_template_kwargs: { enable_thinking: true },
      cache_prompt: false,
      messages: [
        { role: "system", content: "Work carefully using extended private reasoning. Give only a concise final answer." },
        { role: "user", content: testCase.prompt },
      ],
    });
    const message = generated.json.choices?.[0]?.message ?? {};
    const reasoning = typeof message.reasoning_content === "string" ? message.reasoning_content.trim() : "";
    if (!reasoning) throw new Error("response did not contain message.reasoning_content");

    const maxTokens = Math.ceil(reasoning.length / 3);
    process.stdout.write(`${reasoning.length} chars; compact ... `);
    const compacted = await request({
      model,
      id_slot: compactorSlot,
      seed: 3407,
      temperature: 0.1,
      max_tokens: maxTokens,
      thinking_budget_tokens: 0,
      chat_template_kwargs: { enable_thinking: false },
      cache_prompt: false,
      messages: [
        { role: "system", content: "You compress reasoning traces. Output only compact trace." },
        { role: "user", content: buildCompactionPrompt(reasoning) },
      ],
    });
    const compact = typeof compacted.json.choices?.[0]?.message?.content === "string"
      ? compacted.json.choices[0].message.content.trim()
      : "";
    const complete = !["length", "max_tokens"].includes(compacted.finishReason);
    const runtimeAccepted = complete && compact.length > 0 && compact !== "none" && compact.length < reasoning.length && (maxTraceChars < 0 || compact.length <= maxTraceChars);
    const sourceMarkers = testCase.mustRetain.filter((value) => includes(reasoning, value));
    const retainedMarkers = sourceMarkers.filter((value) => includes(compact, value));
    records.push({
      id: testCase.id,
      prompt: testCase.prompt,
      generated: { reasoning, final: message.content ?? "", finishReason: generated.finishReason, latencyMs: generated.latencyMs, usage: generated.json.usage ?? null },
      compaction: {
        text: compact, finishReason: compacted.finishReason, latencyMs: compacted.latencyMs, usage: compacted.json.usage ?? null,
        maxTokens, complete, runtimeAccepted, sourceChars: reasoning.length, outputChars: compact.length,
        thinkingReduction: runtimeAccepted ? 1 - compact.length / reasoning.length : 0,
        markers: { source: sourceMarkers, retained: retainedMarkers, required: testCase.mustRetain },
      },
    });
    console.log(`finish=${compacted.finishReason} ${compact.length} chars accept=${runtimeAccepted} markers=${retainedMarkers.length}/${sourceMarkers.length}`);
  } catch (error) {
    records.push({ id: testCase.id, error: String(error) });
    console.log(`ERROR ${error}`);
  }
}

await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  metadata: { generatedAt: new Date().toISOString(), endpoint, model, mainSlot, compactorSlot, thinkingBudget, mainMaxTokens, maxTraceChars },
  records,
}, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
