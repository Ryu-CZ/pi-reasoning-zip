#!/usr/bin/env node
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const endpoint = (process.env.COMPACTOR_BASE_URL ?? "http://127.0.0.1:7484/v1").replace(/\/+$/, "");
const model = process.env.COMPACTOR_MODEL ?? "unsloth";
const apiKey = process.env.COMPACTOR_API_KEY ?? "sk-placeholder";
const ratios = process.env.BENCHMARK_RATIOS ?? "0.38,0.62,1.0";
const promote = process.argv.includes("--promote");
const help = process.argv.includes("--help") || process.argv.includes("-h");

if (help) {
  console.log(`Usage: npm run benchmark -- [--promote]

Environment:
  COMPACTOR_BASE_URL   OpenAI-compatible base URL (default: http://127.0.0.1:7484/v1)
  COMPACTOR_MODEL      Model id from GET /models (default: unsloth)
  COMPACTOR_API_KEY    API key when required (default: sk-placeholder)
  BENCHMARK_RATIOS     Ratio sweep (default: 0.38,0.62,1.0)
  BENCHMARK_OUTPUT_DIR Parent output directory (default: benchmarks/local-runs)

By default results are written to a timestamped ignored directory. --promote
updates the three checked-in reference artifacts only after every suite succeeds.`);
  process.exit(0);
}

const parsedRatios = ratios.split(",").map(Number);
if (parsedRatios.length === 0 || parsedRatios.some((ratio) => !Number.isFinite(ratio) || ratio <= 0 || ratio > 1)) {
  console.error(`BENCHMARK_RATIOS must be a comma-separated list greater than 0 and at most 1; received ${JSON.stringify(ratios)}`);
  process.exit(1);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function getJson(url) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function preflight() {
  const models = await getJson(`${endpoint}/models`);
  const entry = models?.data?.find((candidate) => candidate?.id === model);
  if (!entry) {
    const available = models?.data?.map((candidate) => candidate?.id).filter(Boolean).join(", ") || "none";
    throw new Error(`Model ${JSON.stringify(model)} was not returned by ${endpoint}/models. Available: ${available}`);
  }

  const serverRoot = endpoint.replace(/\/v1$/, "");
  let slot;
  let slotCount;
  try {
    const slots = await getJson(`${serverRoot}/slots`);
    if (Array.isArray(slots) && slots.length > 0) {
      slotCount = slots.length;
      slot = slots.length > 1 ? 1 : 0;
    }
  } catch {
    // `/slots` is llama.cpp-specific. Other OpenAI-compatible endpoints can omit it.
  }

  return { modelMetadata: entry.meta ?? null, slot, slotCount };
}

function runBenchmark(args, extraEnv = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ["scripts/benchmark-prompts.mjs", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        COMPACTOR_BASE_URL: endpoint,
        COMPACTOR_MODEL: model,
        COMPACTOR_API_KEY: apiKey,
        ...extraEnv,
      },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`Benchmark exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
  });
}

function summarizeGroup(records) {
  const valid = records.filter((record) => !record.error);
  const sourceChars = valid.reduce((sum, record) => sum + record.sourceChars, 0);
  const storedChars = valid.reduce((sum, record) => sum + (record.runtimeAccepted ? record.outputChars : record.sourceChars), 0);
  const retained = valid.reduce((sum, record) => sum + record.exactRetention.retained.length, 0);
  const required = valid.reduce((sum, record) => sum + record.exactRetention.required.length, 0);
  return {
    runs: valid.length,
    errors: records.length - valid.length,
    complete: valid.filter((record) => record.complete).length,
    accepted: valid.filter((record) => record.runtimeAccepted).length,
    exactRetention: `${retained}/${required}`,
    continuationPassed: valid.filter((record) => record.continuation?.passed).length,
    thinkingReduction: sourceChars ? 1 - storedChars / sourceChars : 0,
    meanLatencyMs: valid.length ? Math.round(valid.reduce((sum, record) => sum + record.latencyMs, 0) / valid.length) : 0,
  };
}

async function validateResult(path, expectedRecords) {
  const result = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(result.records) || result.records.length !== expectedRecords) {
    throw new Error(`${path} contains ${result.records?.length ?? 0} records; expected ${expectedRecords}`);
  }
  const errors = result.records.filter((record) => record.error);
  if (errors.length > 0) {
    throw new Error(`${path} contains ${errors.length} request error${errors.length === 1 ? "" : "s"}`);
  }
}

async function summarize(files, preflightResult, outputDirectory) {
  const groups = [];
  for (const [suite, path] of Object.entries(files)) {
    const result = JSON.parse(await readFile(path, "utf8"));
    const grouped = new Map();
    for (const record of result.records) {
      const key = `${record.candidate}@${record.ratio}`;
      grouped.set(key, [...(grouped.get(key) ?? []), record]);
    }
    for (const [configuration, records] of grouped) groups.push({ suite, configuration, ...summarizeGroup(records) });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    endpoint,
    model,
    preflight: preflightResult,
    outputDirectory,
    promoted: promote,
    groups,
  };
  await writeFile(resolve(outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

  const lines = [
    "# Local benchmark summary",
    "",
    `- Endpoint: \`${endpoint}\``,
    `- Model: \`${model}\``,
    `- Output: \`${outputDirectory}\``,
    `- Detected slots: ${preflightResult.slotCount ?? "not exposed"}`,
    "",
    "| Suite | Configuration | Complete | Accepted | Exact spans | Continuation | Thinking reduction | Mean latency |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
    ...groups.map((group) => `| ${group.suite} | ${group.configuration} | ${group.complete}/${group.runs} | ${group.accepted}/${group.runs} | ${group.exactRetention} | ${group.continuationPassed}/${group.runs} | ${(group.thinkingReduction * 100).toFixed(1)}% | ${(group.meanLatencyMs / 1000).toFixed(2)} s |`),
    "",
  ];
  await writeFile(resolve(outputDirectory, "summary.md"), `${lines.join("\n")}\n`);
  console.log(`\n${lines.join("\n")}`);
}

const outputRoot = resolve(process.env.BENCHMARK_OUTPUT_DIR ?? "benchmarks/local-runs");
const outputDirectory = resolve(outputRoot, timestamp());
const files = {
  default: resolve(outputDirectory, "default.json"),
  ratios: resolve(outputDirectory, "ratios.json"),
  heldout: resolve(outputDirectory, "heldout.json"),
};

try {
  console.log(`Preflight: ${endpoint}, model ${model}`);
  const preflightResult = await preflight();
  console.log(`Model ready; context=${preflightResult.modelMetadata?.n_ctx ?? "not reported"}; slots=${preflightResult.slotCount ?? "not exposed"}`);
  await mkdir(outputDirectory, { recursive: true });
  const slotEnv = { COMPACTOR_SLOT: preflightResult.slot === undefined ? "" : String(preflightResult.slot) };

  await runBenchmark(["benchmarks/prompt-comparison/traces.json", files.default], slotEnv);
  await validateResult(files.default, 6);
  await runBenchmark(["benchmarks/prompt-comparison/traces.json", files.ratios], { ...slotEnv, COMPACTION_RATIOS: ratios });
  await validateResult(files.ratios, 6 * parsedRatios.length);
  await runBenchmark(["benchmarks/prompt-comparison/heldout-traces.json", files.heldout], {
    ...slotEnv,
    COMPACTION_CANDIDATES: "typed,terse,surface,typed-surface-safe2-reconsider",
  });
  await validateResult(files.heldout, 12);
  await summarize(files, preflightResult, outputDirectory);

  if (promote) {
    await cp(files.default, "benchmarks/prompt-comparison/final-winner-results.json");
    await cp(files.ratios, "benchmarks/prompt-comparison/final-budget-sweep.json");
    await cp(files.heldout, "benchmarks/prompt-comparison/true-heldout-core-results.json");
    console.log("Promoted completed results to the checked-in reference artifacts.");
  }
} catch (error) {
  console.error(`Benchmark failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`Partial output, if any, remains in ${outputDirectory}`);
  process.exitCode = 1;
}
