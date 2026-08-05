# Benchmark

## Environment

The benchmark ran on 2026-08-05 with:

- Pi `0.83.0`;
- the `pi-reasoning-zip` checkout after commit `8059fc3`;
- local `Qwen3.6-27B-UD-Q4_K_XL.gguf` served by llama.cpp;
- a 73,728-token context with three unified-KV slots; and
- the same model alias (`unsloth`) for main generation and compaction.

This rerun deliberately replaced an earlier run that accidentally used the ThinkingCap model variant. Performance figures describe this host and configuration, not general throughput.

## Methodology

Five reasoning-heavy prompts were generated in fresh, isolated core-Pi sessions. The baseline loaded no extensions and disabled tools, skills, prompt templates, and context files. Each exact baseline thinking block was then sent to the current compactor prompt. This exact-source comparison avoids mixing model-sampling variance with compression.

The compaction run used:

```json
{
  "compactor": {
    "maxCompactionRatio": 0.75,
    "temperature": 0.1
  },
  "thresholds": {
    "minChars": 400,
    "maxInputChars": 20000,
    "maxTraceChars": 2000
  }
}
```

`minChars: 400` deliberately tests aggressive coverage; the built-in default remains 1,000. One generated trace was only 191 characters and was therefore skipped under either threshold. Exact-source compactor requests used slot 1; the separate live check pinned main traffic to slot 0.

## Budget calibration

The lossless-ledger prompt needs enough room to finish before output acceptance checks can run. A truncated response is rejected even if its partial text looks short.

| `maxCompactionRatio` | Complete eligible responses | Runtime result |
|---:|---:|---|
| `0.25` | 0 of 4 | All four eligible responses hit the token limit |
| `0.35` | 0 of 4 | All four eligible responses hit the token limit |
| `0.50` | 0 of 4 | All four eligible responses hit the token limit |
| `0.75` | 4 of 4 | Three stored; one complete output exceeded `maxTraceChars` and was rejected |
| `1.00` | 4 of 4 | Same outputs and acceptance result as `0.75` |

This confirms that the former `0.25` default was too restrictive for the current lossless-ledger prompt. The default is now `0.75`: it leaves generation headroom while validation still requires completed output that is non-empty, strictly shorter than the source, and within `maxTraceChars`. Raising the budget did not force larger results in this run; completed outputs were identical at `0.75` and `1.00`.

## Storage and retention results

| Task | Original thinking | Stored thinking | Change | Result |
|---|---:|---:|---:|---|
| Incident rollback plan | 1,504 chars | 838 chars | -44.3% | Exact path, versions, rates, command, migration rule, lag threshold, uncertainty, and next action retained |
| Double-charge debugging | 5,001 chars | 5,001 chars | 0% | Complete 3,846-character ledger exceeded `maxTraceChars: 2000`; original preserved |
| Sliding-window algorithm | 2,002 chars | 984 chars | -50.8% | Algorithm, inclusive boundary, memory constraint, correctness argument, deduplication, and incorrect approaches retained |
| Redis-to-PostgreSQL migration | 191 chars | 191 chars | 0% | Below `minChars: 400`; no compactor request |
| Inference-service decision | 3,293 chars | 1,162 chars | -64.7% | Hard constraints, all option/workload values, decision, batching uncertainty, TTFT risk, and next action retained |
| **Total** | **11,991 chars** | **8,176 chars** | **-31.8%** | Three traces compacted; two originals safely preserved |

The three accepted traces shrank from 6,799 to 2,984 characters (-56.1%). The built-in 1,000-character threshold produces the same stored result for this sample: it targets the four substantive traces, while the 191-character planning note remains untouched.

Manual comparison found no source fact strengthened or lost in the three accepted outputs. The double-charge output also completed and retained its detailed state, but the independent 2,000-character storage bound intentionally rejected it. Increasing `maxTraceChars` would recover its 23.1% reduction at the cost of allowing larger stored ledgers.

## Whole-session storage effect

To measure more than the thinking blocks, each accepted compact string was substituted into a copy of its exact baseline JSONL session. All headers, prompts, final answers, usage metadata, and rejected or ineligible thinking remained byte-for-byte unchanged.

| Task | Baseline JSONL | Projected compact JSONL | Change |
|---|---:|---:|---:|
| Incident rollback plan | 6,689 bytes | 6,000 bytes | -10.3% |
| Double-charge debugging | 22,417 bytes | 22,417 bytes | 0% |
| Sliding-window algorithm | 11,702 bytes | 10,669 bytes | -8.8% |
| Redis-to-PostgreSQL migration | 2,099 bytes | 2,099 bytes | 0% |
| Inference-service decision | 11,084 bytes | 8,897 bytes | -19.7% |
| **Total** | **53,991 bytes** | **50,082 bytes** | **-7.2%** |

Whole-session savings are smaller than the 31.8% thinking reduction because user prompts, final answers, session headers, and metadata are not compacted. The 7.2% figure is an exact serialized replacement for these five one-turn files, but it is still projected rather than five independently generated treatment sessions; that preserves a controlled, identical source outside the thinking strings.

## Live extension and slot check

A separate isolated Pi run loaded only this checkout's extension with `maxCompactionRatio: 0.75` and `llamaCppSlots.enabled: "auto"`. The finalized session stored a 945-character incident ledger. Immediately after the run, llama.cpp reported:

| Slot | Request | Shape |
|---:|---|---|
| 0 | Main Pi generation | streaming, temperature 0.59375, 4,400-token limit |
| 1 | Reasoning compactor | non-streaming, temperature 0.1, 322-token ratio-derived limit |

This verifies the real hook path, current ratio budget, and separate-slot routing on the present three-slot server. It is a post-run slot-state observation, not continuous sampling of the entire request lifetime.

## Timing observations

The five fresh main generations took 2.0–61.0 seconds each. The four eligible `0.75` compactor requests took 3.1–9.0 seconds each, 20.1 seconds total. These are host-specific wall-clock observations. Compaction adds latency to message finalization; its benefit appears on later turns through reduced stored context.

## Limitations

- Five tasks are enough to catch the token-budget regression but not to establish a universal compression rate.
- Baseline reasoning length and substance vary across independent generations.
- Character-to-token estimation is approximate.
- The primary comparison measures stored thinking; the whole-session table measures JSONL bytes, but neither measures provider billing or long-context time-to-first-token.
- Retention review is manual and limited to state present in each baseline thinking block.
- Results are specific to this prompt, model, server, and host.

After the benchmark, the isolated automated suite passed 86 of 86 tests.
