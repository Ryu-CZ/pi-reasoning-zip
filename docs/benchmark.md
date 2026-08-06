# Prompt benchmark

## Environment

The comparative run was performed on 2026-08-05 with:

- Pi `0.83.0`;
- local `Qwen3.6-27B-UD-Q4_K_XL.gguf` served as `unsloth` by llama.cpp;
- a 73,728-token context and three unified-KV slots;
- compaction pinned to slot 1, temperature `0.1`, seed `3407`, and model-side thinking disabled;
- `thresholds.maxTraceChars: 2000` for this historical comparison; and
- the same exact source string for every prompt candidate.

The previous five-task benchmark established fail-open behavior and exposed the old token-budget problem, but it did not compare prompts or test independent continuation. The results below supersede it for prompt selection.

## Sources and reproducibility

The committed harness and inputs are:

- [`scripts/benchmark-prompts.mjs`](../scripts/benchmark-prompts.mjs);
- [`benchmarks/prompt-comparison/traces.json`](../benchmarks/prompt-comparison/traces.json): six tuning traces, three development and three evaluation;
- [`benchmarks/prompt-comparison/heldout-traces.json`](../benchmarks/prompt-comparison/heldout-traces.json): three blind confirmation traces written after the final candidate was fixed;
- [`benchmarks/prompt-comparison/final-winner-results.json`](../benchmarks/prompt-comparison/final-winner-results.json);
- [`benchmarks/prompt-comparison/final-budget-sweep.json`](../benchmarks/prompt-comparison/final-budget-sweep.json); and
- [`benchmarks/prompt-comparison/true-heldout-core-results.json`](../benchmarks/prompt-comparison/true-heldout-core-results.json).

The traces are deliberately dense, hand-authored reasoning-state records rather than independently sampled model generations. Together they contain exact paths, commands, identifiers, numbers, units, negation, exceptions, uncertainty, causal order, failed attempts and evidence, reconsideration conditions, rollback and abort rules, open questions, success gates, and next actions. Hand-authorship makes required state auditable; it does not reproduce the distribution of natural model reasoning.

Run the selected prompt and its ratio sweep against the intended local endpoint:

```bash
ESTIMATED_CHARS_PER_TOKEN=3 \
MAX_TRACE_CHARS=2000 \
COMPACTION_CANDIDATES=typed-surface-safe2-reconsider \
COMPACTION_RATIOS=1 \
node scripts/benchmark-prompts.mjs \
  benchmarks/prompt-comparison/traces.json \
  benchmarks/prompt-comparison/final-winner-results.json

ESTIMATED_CHARS_PER_TOKEN=3 \
MAX_TRACE_CHARS=2000 \
COMPACTION_CANDIDATES=typed-surface-safe2-reconsider \
COMPACTION_RATIOS=0.25,0.5,0.75 \
node scripts/benchmark-prompts.mjs \
  benchmarks/prompt-comparison/traces.json \
  benchmarks/prompt-comparison/final-budget-sweep.json
```

Run the frozen blind comparison:

```bash
ESTIMATED_CHARS_PER_TOKEN=3 \
MAX_TRACE_CHARS=2000 \
COMPACTION_CANDIDATES=typed,terse,surface,typed-surface-safe2-reconsider \
COMPACTION_RATIOS=1 \
node scripts/benchmark-prompts.mjs \
  benchmarks/prompt-comparison/heldout-traces.json \
  benchmarks/prompt-comparison/true-heldout-core-results.json
```

The harness records raw responses, finish reasons, usage, latency, strict required-span retention, direct failed-attempt evidence/rationale checks, canary/prompt leakage, runtime acceptance, projected JSONL bytes, and an independent continuation request that receives only the compact note. A continuation passes only when it recovers the exact next-action command. Character and canonical JSONL reductions use the original whenever runtime validation rejects an output, matching production fail-open behavior.

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
| Previous typed ledger | 3/3 | 0/3 | 75/75 | 8/9 | 2/3 | 3/3 | 0.0% | 12.55 s |
| Plain terse control | 3/3 | 2/3 | 34/75 | 2/9 | 1/3 | 1/3 | 30.0% | 9.34 s |
| Caveman-inspired surface policy | 3/3 | 3/3 | 68/75 | 6/9 | 3/3 | 2/3 | 22.5% | 6.40 s |
| **Selected hybrid** | **3/3** | **2/3** | **75/75** | **9/9** | **0/3** | **3/3** | **14.4%** | **6.00 s** |

The plain terse control often returned `none`; its small storage figure is therefore not evidence for useful generic brevity. The surface candidate was shortest and always accepted, but it lost exact spans, emitted source canaries, and failed one independent next-action recovery. It was rejected despite the best compression.

The previous typed prompt retained all required spans but produced 2,037–2,161 characters. All three outputs exceeded this comparison's independent 2,000-character storage limit, so that configuration would preserve every original. The selected hybrid produced complete responses for all three. Two outputs were accepted; the dense parser ledger was 2,201 characters and was correctly rejected without raising `maxTraceChars`.

## Budget calibration

The final prompt was swept over the six tuning traces using the production three-characters-per-token estimate:

| `maxCompactionRatio` | Complete responses | Runtime accepted |
|---:|---:|---:|
| `0.25` | 0/6 | 0/6 |
| `0.50` | 0/6 | 0/6 |
| `0.75` | 3/6 | 3/6 |
| `1.00` | 6/6 | 6/6 |

The old `C / 4` estimate and `0.75` default left every typed and surface-policy response truncated at the 0.75 setting. Dense paths, punctuation, and code tokenize above the common four-characters-per-token heuristic. Production now estimates `ceil(C / 3)` and defaults the ratio to `1.0`. This increases generation headroom, not accepted storage: output must still complete, be non-empty, and be strictly shorter than the source. This historical sweep also enabled a 2,000-character `maxTraceChars` guardrail; the current default is `-1` (disabled).

## Retention and storage effect

On the six tuning traces, the selected prompt completed and was accepted 6/6, retained 103/112 strict source spans and 15/16 direct dead-end evidence/rationale checks, emitted zero canaries, and recovered the exact next action 6/6. Manual source comparison found that the nine strict misses were surface normalization rather than changed values—such as `1,200 in` for `1,200 input tokens`—except for one corrected, no-longer-true guess (`v2.18.0`) that was omitted. All marked decision-relevant paths, commands, identifiers, and numeric values remained semantically intact, as did the reviewed negation/exception rules, uncertainties, failed-attempt rationales, stated reconsideration conditions, rollback/abort rules, open questions, causal ordering, and next actions. Corrected discarded values such as the wrong `v2.18.0` guess and wrong path spelling were not retained. No unsupported claim strengthening was found.

The frozen held-out set retained 75/75 strict spans and all 9/9 direct dead-end evidence/rationale checks. Manual review likewise found no strengthened claim or lost negation, uncertainty, dead-end rationale, rollback rule, reconsideration rule, or next action. The rejected 2,201-character parser output also retained 23/23 spans and the correct continuation state; fail-open storage intentionally used its original source.

| Set | Source thinking | Stored thinking | Change | Canonical JSONL bytes | Change |
|---|---:|---:|---:|---:|---:|
| Tuning (6) | 12,687 chars | 9,612 chars | -24.2% | 14,817 -> 11,858 | -20.0% |
| Frozen held-out (3) | 6,893 chars | 5,901 chars | -14.4% | 7,958 -> 6,998 | -12.1% |
| **Combined (9)** | **19,580 chars** | **15,513 chars** | **-20.8%** | **22,775 -> 18,856** | **-17.2%** |

The canonical JSONL projection serializes a fixed session header, user message, assistant thinking block, and final text, then substitutes only accepted thinking. It measures whole serialized test sessions, not provider billing or a natural multi-turn Pi workload.

The nine selected-prompt compactions took 60.5 seconds total (6.7 seconds mean) on this host. Independent continuation probes were separate benchmark requests and are not included in that latency. Compaction delays message finalization; savings benefit later replayed turns.

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
- The historical comparisons and high-reasoning stress check explicitly used `maxTraceChars: 2000`. Dense but faithful outputs can fail open under such an enabled guardrail, as one high-reasoning result did at 2,418 characters; the current default is `-1` (disabled).
