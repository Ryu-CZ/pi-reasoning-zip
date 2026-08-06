# Prompt benchmark

## Environment

The comparative run was repeated on 2026-08-06 with:

- Pi `0.83.0`;
- local `Qwen3.6-27B-UD-Q4_K_XL.gguf` served as `unsloth` by llama.cpp;
- a 53,504-token context per slot and three unified-KV slots;
- compaction pinned to slot 1, temperature `0.1`, seed `3407`, and model-side thinking disabled;
- the production default `thresholds.maxTraceChars: -1` (disabled); and
- the same exact source string for every prompt candidate.

The previous five-task benchmark established fail-open behavior and exposed the old token-budget problem, but it did not compare prompts or test independent continuation. The results below supersede it for prompt selection.

## Run locally

Start any local server that exposes an OpenAI-compatible `GET /v1/models` and `POST /v1/chat/completions`, then run:

```bash
npm run benchmark
```

The defaults target `http://127.0.0.1:7484/v1` and model `unsloth`. Override them without editing files:

```bash
COMPACTOR_BASE_URL=http://127.0.0.1:8080/v1 \
COMPACTOR_MODEL=Qwen3.6-27B \
npm run benchmark
```

The runner verifies that the endpoint returns the requested model. When a llama.cpp `/slots` endpoint is available, it reports the topology and selects slot 1 when possible; other OpenAI-compatible servers can omit `/slots` and the benchmark then omits `id_slot`.

Each run writes `default.json`, `ratios.json`, `heldout.json`, `summary.json`, and `summary.md` under a timestamped, gitignored `benchmarks/local-runs/` directory. Partial failures stay isolated there and never replace the checked-in evidence. The default ratio sweep is `0.38,0.62,1.0`; override it with `BENCHMARK_RATIOS`.

After reviewing a complete local run, explicitly promote its three raw results to the checked-in reference paths with:

```bash
npm run benchmark -- --promote
```

Run `npm run benchmark -- --help` for all local overrides. Promotion does not update prose claims automatically; review the generated summary before documenting or committing new host-specific measurements.

## Sources and reproducibility

The committed harness and inputs are:

- [`scripts/benchmark-prompts.mjs`](../scripts/benchmark-prompts.mjs);
- [`benchmarks/prompt-comparison/traces.json`](../benchmarks/prompt-comparison/traces.json): six tuning traces, three development and three evaluation;
- [`benchmarks/prompt-comparison/heldout-traces.json`](../benchmarks/prompt-comparison/heldout-traces.json): three blind confirmation traces written after the final candidate was fixed;
- [`benchmarks/prompt-comparison/final-winner-results.json`](../benchmarks/prompt-comparison/final-winner-results.json);
- [`benchmarks/prompt-comparison/final-budget-sweep.json`](../benchmarks/prompt-comparison/final-budget-sweep.json);
- [`benchmarks/prompt-comparison/ratio-reliability-sweep.json`](../benchmarks/prompt-comparison/ratio-reliability-sweep.json); and
- [`benchmarks/prompt-comparison/true-heldout-core-results.json`](../benchmarks/prompt-comparison/true-heldout-core-results.json).

The traces are deliberately dense, hand-authored reasoning-state records rather than independently sampled model generations. Together they contain exact paths, commands, identifiers, numbers, units, negation, exceptions, uncertainty, causal order, failed attempts and evidence, reconsideration conditions, rollback and abort rules, open questions, success gates, and next actions. Hand-authorship makes required state auditable; it does not reproduce the distribution of natural model reasoning.

Run the selected prompt and its ratio sweep against the intended local endpoint:

```bash
node scripts/benchmark-prompts.mjs \
  benchmarks/prompt-comparison/traces.json \
  benchmarks/prompt-comparison/final-winner-results.json

COMPACTION_RATIOS=0.38,0.62,1.0 \
node scripts/benchmark-prompts.mjs \
  benchmarks/prompt-comparison/traces.json \
  benchmarks/prompt-comparison/final-budget-sweep.json
```

Run the frozen blind comparison:

```bash
COMPACTION_CANDIDATES=typed,terse,surface,typed-surface-safe2-reconsider \
node scripts/benchmark-prompts.mjs \
  benchmarks/prompt-comparison/heldout-traces.json \
  benchmarks/prompt-comparison/true-heldout-core-results.json
```

The harness records raw responses, finish reasons, usage, latency, strict required-span retention, direct failed-attempt evidence/rationale checks, canary/prompt leakage, runtime acceptance, projected JSONL bytes, and an independent continuation request that receives only the compact note. A continuation passes only when it recovers the exact next-action command. Character and canonical JSONL reductions use the original whenever runtime validation rejects an output, matching production fail-open behavior.

## Metric glossary

| Metric | Definition | Interpretation |
|---|---|---|
| Source trace | The complete fixture reasoning text sent to every candidate. | Candidate comparisons are controlled because they use the identical source string. |
| Generated output | The compactor response before runtime validation. | It can be incomplete or rejected and therefore may differ from what Pi stores. |
| Complete | The response finish reason is neither `length` nor `max_tokens`. | Completion is necessary but not sufficient for runtime acceptance. |
| Runtime accepted | The output completed, contains no inline reasoning wrapper, is neither empty nor `none`, is shorter than its source, and does not exceed an enabled positive `maxTraceChars` guardrail. | Accepted output replaces the source thinking; rejected output does not. |
| Exact required span | A fixture-defined decision-relevant string from `mustRetain`, such as a command, path, identifier, number, unit, or condition. The check searches the generated output case-insensitively for that otherwise verbatim string. | This is deliberately strict. Equivalent wording such as `1,200 in` does not satisfy the expected `1,200 input tokens`, so a miss requires review but does not by itself prove semantic loss. |
| Exact spans in generated output | Retained required spans divided by all required spans, aggregated across the tested traces. | For truncated responses this measures partial text only; it does not describe stored session state. |
| Failed-attempt check | A fixture-defined evidence or rejection-reason string from `deadEndChecks`. | Tests whether compact notes retain not only that an option failed, but decision-relevant evidence or why it must not be retried. |
| Instruction-leakage canary | A fixture string that imitates an instruction embedded in the source, plus selected benchmark-prompt phrases. | Any match is undesirable because source instructions should be omitted rather than copied into replayable reasoning. |
| Continuation probe | A separate model request that receives only the generated compact note and must reconstruct structured task state. | It tests whether the note supports continued work without access to the original reasoning. |
| Exact next action | The continuation probe's `next` field contains the fixture-defined expected next action using the same case-insensitive exact-string check. | This is the continuation pass criterion. It tests operational recovery of the concrete next command, not complete retention of every fact. |
| Source to stored thinking | Source characters compared with the characters Pi would store. Runtime-accepted output is stored; otherwise the complete original is used. | Mirrors production fail-open behavior. |
| Stored-thinking reduction | `1 - stored thinking characters / source thinking characters`. | Rejected results contribute 0% because Pi preserves their originals. |
| Session JSONL reduction | Reduction in a canonical fixed session projection after substituting only the stored thinking block. | Estimates serialized session-size effect, not provider billing or a natural multi-turn workload. |
| Compaction latency | Wall time of the compactor request. | Excludes the separate continuation probe and is specific to the tested host, server, and model. |
| Mean latency | Arithmetic mean compaction latency across records in the row. | Useful for local comparison, not a universal performance claim. |
| Fail-open preservation | When runtime validation rejects output, the benchmark counts the complete original as stored. | Protects session state but yields no compression for that record; it must not be presented as successful compaction. |

## Core candidates

Four candidates received the identical blind sources and budget:

- **Typed**: the previous F/C/D/X/U/R/O/N lossless-state ledger.
- **Terse**: the same compression task with only `Answer concisely.` as its style instruction.
- **Surface**: a Caveman-inspired surface-deletion policy without typed state categories.
- **Selected hybrid**: typed ledger plus selective surface deletion, explicit source-instruction omission, and preservation of source-stated reconsideration conditions.

The surface policy was independently worded from general principles. It was inspired by [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) at commit `ec83e5b`; Caveman is MIT-licensed, copyright 2026 Julius Brussee. No substantial Caveman prompt text is copied here. Caveman itself targets concise assistant output, not reasoning-state compaction, so this benchmark does not claim its upstream results apply to this extension.

## Blind held-out result

All figures below are from the three frozen held-out traces at ratio `1.0` with the three-characters-per-token estimator.

| Candidate | Complete | Runtime accepted | Strict spans | Dead-end checks | Leakage canaries | Exact next action | Stored-thinking reduction | Mean latency |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Previous typed ledger | 3/3 | 3/3 | 75/75 | 8/9 | 2/3 | 3/3 | 8.8% | 6.79 s |
| Plain terse control | 3/3 | 2/3 | 34/75 | 2/9 | 1/3 | 1/3 | 30.0% | 3.68 s |
| Caveman-inspired surface policy | 3/3 | 3/3 | 68/75 | 6/9 | 3/3 | 2/3 | 22.5% | 6.76 s |
| **Selected hybrid** | **3/3** | **3/3** | **75/75** | **9/9** | **0/3** | **3/3** | **15.4%** | **6.14 s** |

The plain terse control often returned `none`; its small storage figure is therefore not evidence for useful generic brevity. The surface candidate was shortest and always accepted, but it lost exact spans, emitted source canaries, and failed one independent next-action recovery. It was rejected despite the best compression.

The previous typed prompt retained all required spans but was consistently longer than the selected hybrid. With the production size cap disabled, all complete outputs shorter than their sources were accepted. The selected hybrid completed and was accepted for all three traces, including the dense 2,170-character parser ledger.

## Budget calibration

The final prompt was swept over the six tuning traces using the production three-characters-per-token estimate. The finer reliability sweep ran from `0.60` through `1.00` in steps of `0.04`:

| `maxCompactionRatio` | Complete and accepted | Exact spans in generated output | Exact next action | Stored-thinking reduction |
|---:|---:|---:|---:|---:|
| `0.60` | 0/6 | 94/112 | 0/6 | 0.0% |
| `0.64` | 0/6 | 95/112 | 0/6 | 0.0% |
| `0.68` | 0/6 | 100/112 | 0/6 | 0.0% |
| `0.72` | 1/6 | 100/112 | 1/6 | 5.5% |
| `0.76` | 4/6 | 102/112 | 4/6 | 19.7% |
| `0.80` | 6/6 | 103/112 | 6/6 | 24.0% |
| `0.84` | 6/6 | 103/112 | 6/6 | 24.0% |
| `0.88` | 6/6 | 103/112 | 6/6 | 24.0% |
| `0.92` | 6/6 | 103/112 | 6/6 | 24.0% |
| `0.96` | 6/6 | 103/112 | 6/6 | 24.0% |
| `1.00` | 6/6 | 103/112 | 6/6 | 24.0% |

Span counts for truncated responses measure partial generated text, not stored compact reasoning. Production rejected those outputs and retained the complete originals. `0.80` was the lowest ratio to complete all six fixtures in this run, but six synthetic traces do not establish a safe general threshold. The production ratio remains `1.0` to leave headroom for longer or less structured reasoning. This increases generation headroom, not accepted storage: output must still complete, be non-empty, and be strictly shorter than the source. The sweep used the production `maxTraceChars: -1` default, so failures below `0.80` were caused by generation truncation rather than the optional storage guardrail.

## Retention and storage effect

On the six tuning traces, the selected prompt completed and was accepted 6/6, retained 103/112 strict source spans and 15/16 direct dead-end evidence/rationale checks, emitted zero canaries, and recovered the exact next action 6/6. Manual source comparison found that the nine strict misses were surface normalization rather than changed values—such as `1,200 in` for `1,200 input tokens`—except for one corrected, no-longer-true guess (`v2.18.0`) that was omitted. All marked decision-relevant paths, commands, identifiers, and numeric values remained semantically intact, as did the reviewed negation/exception rules, uncertainties, failed-attempt rationales, stated reconsideration conditions, rollback/abort rules, open questions, causal ordering, and next actions. Corrected discarded values such as the wrong `v2.18.0` guess and wrong path spelling were not retained. No unsupported claim strengthening was found.

The frozen held-out set retained 75/75 strict spans and all 9/9 direct dead-end evidence/rationale checks. Manual review likewise found no strengthened claim or lost negation, uncertainty, dead-end rationale, rollback rule, reconsideration rule, or next action. All three outputs passed runtime acceptance and independent continuation recovery.

| Set | Source thinking | Stored thinking | Change | Canonical JSONL bytes | Change |
|---|---:|---:|---:|---:|---:|
| Tuning (6) | 12,687 chars | 9,637 chars | -24.0% | 14,817 -> 11,883 | -19.8% |
| Frozen held-out (3) | 6,893 chars | 5,829 chars | -15.4% | 7,958 -> 6,958 | -12.6% |
| **Combined (9)** | **19,580 chars** | **15,466 chars** | **-21.0%** | **22,775 -> 18,841** | **-17.3%** |

The canonical JSONL projection serializes a fixed session header, user message, assistant thinking block, and final text, then substitutes only accepted thinking. It measures whole serialized test sessions, not provider billing or a natural multi-turn Pi workload.

The nine selected-prompt compactions took 56.6 seconds total (6.3 seconds mean) on this host. Independent continuation probes were separate benchmark requests and are not included in that latency. Compaction delays message finalization; savings benefit later replayed turns.

## Live high-reasoning stress check

The prompt-selection comparison above deliberately uses identical hand-authored sources. To see how the selected production compactor behaves on longer model-generated reasoning, a separate two-run check used [`scripts/high-reasoning-zip.mjs`](../scripts/high-reasoning-zip.mjs). The runner generated three difficult tasks sequentially on main slot 0, captured `message.reasoning_content`, and compacted that captured text on slot 1 using the production selected prompt, `ceil(C / 3)` budget at ratio `1`, and an explicitly configured 2,000-character acceptance cap. It does **not** compare prompt candidates or establish semantic retention as rigorously as the exact-source benchmark.

The local llama.cpp server used `--reasoning on --reasoning-preserve --reasoning-budget 8192`, a 53,284-token unified context, and three slots. Each main request sent `thinking_budget_tokens: 8192`, `max_tokens: 10000`, `temperature: 0.1`, and seed `3407`; compactor requests sent `thinking_budget_tokens: 0`, `temperature: 0.1`, and used slot 1. The two runs were sequential to avoid slot-contention timing effects:

```bash
npm run build
MAX_TRACE_CHARS=2000 node scripts/high-reasoning-zip.mjs benchmarks/high-reasoning/run-1.json
MAX_TRACE_CHARS=2000 node scripts/high-reasoning-zip.mjs benchmarks/high-reasoning/run-2.json
node scripts/summarize-high-reasoning.mjs
```

Raw responses and the aggregate are kept under [`benchmarks/high-reasoning/`](../benchmarks/high-reasoning/): [`run-1.json`](../benchmarks/high-reasoning/run-1.json), [`run-2.json`](../benchmarks/high-reasoning/run-2.json), and [`summary.json`](../benchmarks/high-reasoning/summary.json).

| Aggregate | Reasoning source | Production stored thinking | Reduction | Runtime accepted | Mean generation latency | Mean compaction latency |
|---|---:|---:|---:|---:|---:|---:|
| Run 1 (3) | 27,106 chars | 4,647 chars | -82.9% | 3/3 | 35.9 s | 6.3 s |
| Run 2 (3) | 31,319 chars | 15,732 chars | -49.8% | 2/3 | 39.4 s | 6.3 s |
| **Pooled (6)** | **58,425 chars** | **20,379 chars** | **-65.1%** | **5/6** | **37.7 s** | **6.3 s** |

The mean of the two run-level reductions is **-66.3%**. The pooled number is lower because run 2 contained a 2,418-character compact result, which production rejected and therefore stored as its 13,324-character original. Across task markers that actually appeared in the generated reasoning, compact notes retained 29/34. That is only a lightweight literal check: generated reasoning may omit task input, and neither it nor the marker score proves complete preservation, absence of claim strengthening, or continuation quality. Inspect raw responses before using this as a retention claim.

## Iteration record

Each iteration changed one prompt dimension from a named predecessor and reused exact sources:

| Variant | Change | Concrete result and disposition |
|---|---|---|
| Typed baseline | Existing ledger | Strong strict retention, but frequent truncation/over-limit outputs and framed source canaries. |
| Surface | Replace typed schema with selective surface deletion | Better compression, weaker exact/continuation retention, canary quotations; rejected. |
| Typed + surface | Add surface deletion to typed baseline | Improved completion while retaining state, but quoted framed canaries; retained for refinement. |
| Explicit size target | Add 50–60% character target | Model often exceeded the requested target; no reliable 0.75-budget completion gain; rejected. |
| Source-instruction omission | Omit quoted/described source instructions | Removed canaries, but one tuning trace lost a stated speculative-profile reconsideration condition. |
| Broad alternative rule | Require a reconsideration rule for every rejected option | Invented a reconsideration condition not present in one source; rejected. |
| Source-stated reconsideration rule | Preserve only conditions actually stated | Restored the missing rule without requiring invention, but one framed canary survived. |
| **Selected hybrid** | Strengthen only source-instruction elision | Zero canaries on tuning and frozen held-out sets, all stated reconsideration rules retained, all next actions recoverable. |

Raw intermediate rounds remain under `benchmarks/prompt-comparison/` so these diagnoses are auditable.

## Limitations

- Six tuning and three held-out traces are substantially stronger coverage than the old five-task benchmark, but still too small for universal rates. The held-out sources were written after selection was fixed, but artifacts are introduced together in this change, so that freeze chronology is procedural rather than independently cryptographically verifiable.
- Inputs are synthetic state-dense traces. Natural local-model reasoning may be less structured, more repetitive, multilingual, or much longer.
- Only one local model, quantization, temperature, server, and host were tested. The two sequential high-reasoning runs varied even with a fixed seed; two runs illustrate variance but do not characterize it.
- Strict span matching is conservative about harmless wording and unit normalization. Direct dead-end checks cover specific failed-attempt evidence/rationale spans, while the continuation probe only gates exact next-action recovery; manual review remains necessary and is not blinded or independently replicated.
- The continuation probe uses the same local model family and checks the exact next action. Its additional rollback/uncertainty/reconsideration fields are diagnostic, not the pass criterion, because several notes contain multiple valid rollback or reconsideration rules.
- Leakage checks use one canary across several phrasings plus a short prompt-phrase list and manual review; they do not cover arbitrary adversarial inputs. The source remains untrusted and downstream models must still treat stored reasoning as data.
- The current exact-source comparison uses the default `maxTraceChars: -1`. The earlier high-reasoning stress check explicitly used `maxTraceChars: 2000`; one dense but faithful 2,418-character output therefore failed open. That result remains historical and does not describe the current default.
