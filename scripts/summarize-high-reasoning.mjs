#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [run1Path = resolve("benchmarks/high-reasoning/run-1.json"), run2Path = resolve("benchmarks/high-reasoning/run-2.json"), outputPath = resolve("benchmarks/high-reasoning/summary.json")] = process.argv.slice(2).map((path) => resolve(path));
const runs = await Promise.all([run1Path, run2Path].map(async (path) => ({ path, data: JSON.parse(await readFile(path, "utf8")) })));

function summarize(records) {
  const sum = (get) => records.reduce((total, record) => total + get(record), 0);
  const sourceChars = sum((record) => record.compaction.sourceChars);
  const storedChars = sum((record) => record.compaction.runtimeAccepted ? record.compaction.outputChars : record.compaction.sourceChars);
  const accepted = records.filter((record) => record.compaction.runtimeAccepted).length;
  const markerSource = sum((record) => record.compaction.markers.source.length);
  const markerRetained = sum((record) => record.compaction.markers.retained.length);
  return {
    traces: records.length,
    sourceChars,
    storedChars,
    thinkingReduction: 1 - storedChars / sourceChars,
    runtimeAccepted: `${accepted}/${records.length}`,
    generatedReasoningCharsMean: sourceChars / records.length,
    generationLatencyMsMean: sum((record) => record.generated.latencyMs) / records.length,
    compactionLatencyMsMean: sum((record) => record.compaction.latencyMs) / records.length,
    sourcePresentMarkers: `${markerRetained}/${markerSource}`,
  };
}

const runSummaries = runs.map(({ path, data }) => ({ name: path.split("/").at(-1)?.replace(/\.json$/, "") ?? path, ...summarize(data.records) }));
const pooled = summarize(runs.flatMap((run) => run.data.records));
const summary = {
  metadata: {
    generatedAt: new Date().toISOString(),
    sourceRuns: runs.map(({ path }) => path.split("/").at(-1)),
    methodology: "Two sequential end-to-end runs: generation on llama.cpp slot 0 with thinking_budget_tokens=8192 and max_tokens=10000; selected production compactor on slot 1 with thinking disabled, C/3 token estimate, ratio 1, and unchanged maxTraceChars=2000.",
    interpretation: "storedChars uses the original reasoning when runtime acceptance rejects an output, exactly as production fail-open behavior does. Marker rates only assess task markers that appeared in the generated reasoning source; they are not a complete semantic-retention audit.",
  },
  runSummaries,
  meanPerRun: { thinkingReduction: runSummaries.reduce((total, run) => total + run.thinkingReduction, 0) / runSummaries.length },
  pooled,
};
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
