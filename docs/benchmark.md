# Benchmark

## Environment

The benchmark ran on 2026-08-01 with:

- Pi `0.83.0`;
- `pi-reasoning-zip` `0.5.0`;
- a local 27B Qwen3.6-derived Q4 model served by llama.cpp;
- an 83,968-token context with two unified-KV slots; and
- the same model (`unsloth`) for main generation and compaction.

Performance figures below describe this host and configuration. They are not general throughput claims.

## Methodology

Five reasoning-heavy tasks were run in isolated arms:

- **Baseline:** core Pi with no extensions.
- **Treatment:** core Pi plus only `pi-reasoning-zip` loaded from this checkout.
- Both arms disabled tools, skills, prompt templates, and context files.
- Both used fresh one-turn sessions, identical prompts, the same model, and the same thinking level.
- The treatment did not change the main-model prompt.

Test settings were:

```json
{
  "compactor": {
    "temperature": 0.1
  },
  "thresholds": {
    "minChars": 400,
    "maxInputChars": 20000,
    "maxTraceChars": 2000
  }
}
```

This benchmark predates ratio-based budgeting and used the former fixed 512-token request cap, which is no longer configurable.

Independent local generations produced different reasoning lengths. Direct enabled/disabled totals would therefore combine sampling variance with compression. The controlled storage and retention comparison sent each exact baseline trace to the same configured compactor.

## Storage and retention results

| Task | Original thinking | Compact thinking | Change | Retention result |
|---|---:|---:|---:|---|
| Incident rollback plan | 1,261 chars | 378 chars | -70.0% | All supplied facts, thresholds, path, command, and migration constraint retained |
| Double-charge debugging | 3,934 chars | 830 chars | -78.9% | Claim/retry design and failed approaches retained; some API-idempotency nuance condensed |
| Sliding-window algorithm | 2,079 chars | 560 chars | -73.1% | Algorithm, inclusive boundary, correctness argument, and complexity retained |
| Redis-to-PostgreSQL migration | 467 chars | 349 chars | -25.3% | All explicit migration constraints retained |
| Inference-service decision | 599 chars | 474 chars | -20.9% | Hard constraints and option data retained; workload and TTFT details were omitted |
| **Total** | **8,340 chars** | **2,591 chars** | **-68.9%** | Core continuation state retained, with greater detail loss in the shortest trace |

The 400-character threshold compacted all five traces, including live Pi storage checks for the two short task classes. The two shortest traces required two additional model requests to save 243 characters, and one lost secondary context. A higher threshold reduces compactor calls; 400 favors aggressive coverage. The built-in default is 1,000 characters.

An earlier seven-session local aggregate recorded the following measured totals. The original README did not provide per-task methodology for this aggregate, so it should not be compared directly with the controlled exact-source table above.

| Metric across 7 sessions | Normal | Zip on | Change |
|---|---:|---:|---:|
| Stored thinking characters | 15,242 | 4,631 | -69.6% |
| Complete session JSONL bytes | 57,902 | 49,317 | -14.8% |

## Slot-isolation verification

An auto-mode run sampled `/slots` every 100 ms and correlated 413 samples with `llama-think.service` logs.

| Request | Slot | llama.cpp task | Duration | Observed request shape |
|---|---:|---:|---:|---|
| Main Pi generation | 0 | 1124 | 17.53 s | Streaming, temperature 0.59375, 4,400-token limit |
| Reasoning compactor | 1 | 1901 | 1.77 s | Non-streaming, temperature 0.1, 512-token limit |

Logs showed explicit selection by ID. The main request used slot 0 and released it; the compactor then used slot 1. No slot collision occurred, and the session stored a valid compact trace.

The main model generated about 77.7 tokens/s and the compactor about 102.5 tokens/s in this run. These are observed host-specific measurements.

## Cache-reuse observations

A separate multi-turn run measured prompt-cache reuse after compaction.

| Stage | Slot | Prompt tokens newly evaluated | Approximate cached prefix reused |
|---|---:|---:|---:|
| Initial main turn | 0 | 504 | N/A |
| Compactor | 1 | 275 | Separate slot; slot 0 untouched |
| First main turn after compaction | 0 | 950 | 524 tokens, about 35.5% of its prompt |
| Repeated follow-up | 0 | 54 | 1,578 tokens, about 96.7% of its prompt |

The compactor did not overwrite slot 0. The first follow-up reused the unchanged conversation prefix but evaluated the suffix where stored compact reasoning differed from the original generation. Once slot 0 contained the compact replay form, the next turn reused nearly the whole prompt.

Slot isolation prevents wholesale cache invalidation. It cannot prevent the intentional reasoning replacement from changing the first-follow-up suffix.

## Extrapolation

At the observed local prompt-processing range of roughly 1,000–2,000 tokens/s:

- rebuilding a completely lost 60k-token prompt would take approximately 30–60 seconds; and
- preserving its prefix and evaluating a 1k–3k-token suffix would take approximately 1–3 seconds before output generation.

These values are extrapolations, not a measured 60k-token benchmark. Long-context throughput may be lower. The 83,968-token unified KV pool is shared: a 60k-token main cache plus a modest compactor request leaves useful headroom, while operation near the context limit may still force eviction.

## Limitations

- The compression comparison measures storage and retention, not end-to-end latency or provider token billing.
- Compaction adds another model request.
- Cache savings occur on later turns and depend on session length, prefix similarity, slot isolation, and available KV capacity.
- Live enabled and disabled generations are not exact-source comparisons because local sampling varies.
- Compression and throughput results are specific to the tested prompts, model, server, and host.
- Short traces may save little and lose secondary detail.

After the live checks, the isolated automated suite passed 89 of 89 tests.
