<p align="center">
  <img src="https://raw.githubusercontent.com/Ryu-CZ/pi-reasoning-zip/main/media/banner.webp" alt="pi-reasoning-zip banner" />
</p>

# pi-reasoning-zip

<p>
  <a href="https://www.npmjs.com/package/pi-reasoning-zip">
    <img src="https://img.shields.io/npm/v/pi-reasoning-zip" alt="npm version">
  </a>
  <a href="https://www.npmjs.com/package/pi-reasoning-zip">
    <img src="https://img.shields.io/npm/dt/pi-reasoning-zip" alt="npm downloads">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/npm/l/pi-reasoning-zip" alt="license">
  </a>
  <a href="https://pi.dev/packages/pi-reasoning-zip">
    <img src="https://img.shields.io/badge/pi-package-1a1a2e" alt="pi package">
  </a>
</p>

Compress visible reasoning blocks before Pi stores them in the session. This shortens replayed context, but each compaction adds a model request, tokens, and latency.

## When to use it

Use this extension with local or open reasoning models that expose their full `thinking` blocks to Pi. It replaces eligible new assistant thinking with a shorter reasoning block before storage; later turns replay that compact form.

It is usually not useful for hosted closed models that expose only opaque or already summarized reasoning. It also offers little benefit when reasoning blocks are short: compaction may cost more than it saves.

## How it works

<p align="center">
  <img src="https://raw.githubusercontent.com/Ryu-CZ/pi-reasoning-zip/main/media/diagram-zip-flow.svg" alt="Reasoning context flow for closed and open models" />
</p>

1. Pi finishes a new assistant message containing eligible visible reasoning.
2. The extension sends each eligible reasoning block to the configured compactor.
3. If the result passes validation, Pi stores the compact block; otherwise it stores the original.
4. Future turns replay what Pi stored. Earlier session entries are never rewritten.

## Benchmark results

The latest benchmark ran on 2026-08-06 with local `Qwen3.6-27B-UD-Q4_K_XL.gguf` and the current default settings. It used six examples while tuning and three new examples for a final check. The examples were hand-written to contain difficult details such as commands, numbers, failed attempts, rollback rules, uncertainties, and next steps. They are useful for comparison, but they are not real Pi sessions.

### Current compression settings

When compression fails a safety check, the original reasoning is kept. The results below count that original rather than pretending the failed compression was useful.

| Set | Successful | Key details kept | Failed attempts kept | Correct next step | Before -> after | Thinking saved | Full session saved |
|---|---:|---:|---:|---:|---:|---:|---:|
| Tuning (6) | 6/6 | 103/112 | 15/16 | 6/6 | 12,687 -> 9,637 chars | 24.0% | 19.8% |
| Frozen held-out (3) | 3/3 | 75/75 | 9/9 | 3/3 | 6,893 -> 5,829 chars | 15.4% | 12.6% |
| **Combined (9)** | **9/9** | **178/187** | **24/25** | **9/9** | **19,580 -> 15,466 chars** | **21.0%** | **17.3%** |

None of the selected outputs copied the fake instructions hidden in the source. Manual comparison found no changed important value, missing rollback rule, missing uncertainty, missing next step, or unsupported stronger claim. Nine key-detail checks missed because of harmless wording changes or because an obsolete corrected guess was omitted; one failed-attempt phrase also used different wording. These results cover only the nine tested examples and do not guarantee that every possible reasoning trace will be lossless.

Compression took 56.6 seconds across the nine examples on this computer (6.3 seconds each on average), not including the separate next-step checks. This extra request delays the answer slightly; the space saving helps later turns that would otherwise reread the full reasoning.

### Why these defaults

On the three frozen held-out traces, the selected prompt kept 75/75 key details and 9/9 failed-attempt checks, copied none of the embedded fake instructions, and recovered the correct next step 3/3 times. The previous typed prompt kept 75/75 details but copied fake instructions in 2/3 traces and reduced thinking by only 8.8%. A plain terse control reduced thinking by 30.0% after rejected results were counted as originals, but kept only 34/75 details and recovered 1/3 next steps. A Caveman-inspired surface policy reduced thinking by 22.5% but kept 68/75 details, copied fake instructions in 3/3 traces, and recovered 2/3 next steps.

An additional reliability sweep tested the current compression instructions from ratio `0.60` through `1.00` in steps of `0.04` on the six tuning examples:

| `maxCompactionRatio` | Successful | Key details present | Correct next step | Stored thinking saved |
|---:|---:|---:|---:|---:|
| `0.60` | 0/6 | 94/112 | 0/6 | 0.0%* |
| `0.64` | 0/6 | 95/112 | 0/6 | 0.0%* |
| `0.68` | 0/6 | 100/112 | 0/6 | 0.0%* |
| `0.72` | 1/6 | 100/112 | 1/6 | 5.5%* |
| `0.76` | 4/6 | 102/112 | 4/6 | 19.7%* |
| `0.80` | 6/6 | 103/112 | 6/6 | 24.0% |
| `0.84` | 6/6 | 103/112 | 6/6 | 24.0% |
| `0.88` | 6/6 | 103/112 | 6/6 | 24.0% |
| `0.92` | 6/6 | 103/112 | 6/6 | 24.0% |
| `0.96` | 6/6 | 103/112 | 6/6 | 24.0% |
| `1.00` | 6/6 | 103/112 | 6/6 | 24.0% |

> **How to read this:**
> - **Key details** are important commands, paths, names, numbers, and conditions that should survive compression. The check is strict, so the same fact written differently may not count.
> - **Correct next step** means another model could read only the shortened notes and still identify the exact action to take next. See the [technical definitions](https://github.com/Ryu-CZ/pi-reasoning-zip/blob/main/docs/benchmark.md#metric-glossary).
> - `*` Some or all compacted outputs stopped before finishing and were rejected. The extension stored the original reasoning instead, so this percentage shows space saved in the actual session—not how short the rejected output was.

The key-detail counts below `0.80` come from unfinished output that was never stored. The extension rejected it and kept the complete original, so no source information was lost but no space was saved. `0.80` was the lowest ratio that handled all six examples, but six hand-written examples are not enough to call it a safe default. `1.00` gives the model more room for longer or messier reasoning. The saved result must still finish and be shorter than the original.

Only one model and computer setup were tested, and nobody independently repeated the manual review. Treat these numbers as a local example, not a promise for every model. See the full [technical benchmark report](https://github.com/Ryu-CZ/pi-reasoning-zip/blob/main/docs/benchmark.md), or run `npm run benchmark` against your own OpenAI-compatible model.

## Install

From npm:

```bash
pi install npm:pi-reasoning-zip
```

From Git:

```bash
pi install git:github.com/Ryu-CZ/pi-reasoning-zip
```

## Quick start

Add a minimal configuration to project `.pi/settings.json` or global `~/.pi/agent/settings.json`:

```json
{
  "reasoningZip": {
    "enabled": true,
    "mode": "local-only",
    "compactor": {
      "baseUrl": "http://127.0.0.1:8080/v1",
      "model": "Qwen3.6-27B"
    }
  }
}
```

For llama.cpp, a minimal local server example is:

```bash
llama-server \
  --model /path/to/Qwen3.6-27B.gguf \
  --alias Qwen3.6-27B
```

Toggle the extension and inspect the effective toggle source:

```text
/zip
/zip status
```

## Commands

```text
/zip
/zip status
/zip enable [global|project]
/zip disable [global|project]
/zip toggle [global|project]
```

The bare `/zip` command toggles the extension. `/reasoning-zip` remains available as a deprecated compatibility alias. Without a scope, writes update the nearest existing `reasoningZip` settings section and otherwise use global settings. Settings are reread for each hook call, so toggles affect subsequent compaction. When enabled, Pi's footer shows the global `reasoningZip.footerStatus` value (`🗜️ Zip` by default).

## Configuration

Project settings override global settings, except `footerStatus`, which is read only from global settings.

| Setting | Built-in default | Purpose |
|---|---|---|
| `enabled` | `true` | Enable extension behavior |
| `mode` | `local-only` | Select eligible providers |
| `footerStatus` | `🗜️ Zip` | Footer text from global settings |
| `llamaCppSlots.enabled` | `false` | Opt in to llama.cpp slot pinning |

See [Configuration](docs/configuration.md) for every field, default, targeting mode, endpoint option, slot control, and threshold.

## llama.cpp cache isolation

When Pi and the compactor share a llama.cpp server, an unpinned compactor request can reuse and replace the main conversation's slot, invalidating its reusable KV cache. Give the server at least two slots and pin main and compactor traffic separately.

Slot pinning is **opt-in**. This is the recommended shared-server configuration, not the built-in default:

```bash
llama-server \
  --model /path/to/Qwen3.6-27B.gguf \
  --alias Qwen3.6-27B \
  --parallel 2 \
  --kv-unified \
  --no-cache-idle-slots \
  --slots
```

```json
{
  "reasoningZip": {
    "llamaCppSlots": {
      "enabled": "auto",
      "mainIdSlot": 0,
      "compactorIdSlot": 1
    }
  }
}
```

`"auto"` probes `GET /slots` and pins only when the shared endpoint has at least two non-colliding slots. Use `true` only when you guarantee the topology; use `false` to disable pinning. Keep `/slots` on a trusted interface because it exposes runtime information.

See [llama.cpp slot pinning](docs/llama-cpp-slot-pinning.md) for unified versus fixed KV, auto-mode safeguards, ID wrapping, edge cases, and verification.

## Safety and limitations

- Compaction is forward-only: it changes only an eligible assistant message being finalized, never previous or replayed entries.
- Fail-open compaction preserves original reasoning after endpoint errors, timeouts, invalid output, or unknown payloads, and shows a Pi warning for request failures.
- Auto slot isolation fails closed: unsafe or ambiguous shared-server topology skips compaction and preserves the original reasoning.
- The extension skips non-assistant messages, non-array content, blocks below `minChars`, blocks above the automatic compactor-context source limit (or its fallback), and providers excluded by the selected mode. Tool-call blocks are preserved while eligible thinking blocks in the same message are compacted.
- It skips signed, encrypted, redacted, and provider-opaque reasoning. Pi's `thinkingSignature: "reasoning_content"` is treated as plain llama.cpp reasoning, not an opaque signature.
- A compact result is rejected when it is empty, `none`, not shorter than the source, or when it exceeds a positive `maxTraceChars` guardrail. Inline reasoning wrappers and truncated compactor output are also rejected. The default `maxTraceChars: -1` disables that optional guardrail.
- It does not reduce hidden provider-side reasoning tokens. It adds a compactor request and may lose secondary detail, especially on short traces.
- The extension never modifies the main model's system, developer, user, or assistant messages before generation. Its `before_provider_request` hook is used only for optional llama.cpp slot fields.

## Troubleshooting

| Symptom | Check |
|---|---|
| No block was compacted | Confirm the message is from the assistant, has array content, meets `minChars` and the automatic compactor-context source limit (or fallback), and is eligible for the selected `mode`. |
| Original reasoning was preserved | Check Pi warnings and compactor output. Errors, empty/`none` output, longer output, and output over an enabled positive `maxTraceChars` guardrail are rejected. |
| Auto slot mode skips compaction | Verify `GET /slots` succeeds with the compactor API key, reports at least two slots, and configured IDs do not collide after wrapping. |
| Next llama.cpp turn reprocesses too much prompt | Confirm main and compactor requests use different slots. The first turn after compaction still evaluates the changed suffix by design. |
| `local-only` skips a custom provider | Confirm Pi exposes it as a local URL provider or `llama-server=` endpoint; otherwise choose a mode that targets it intentionally. |

## Development

See the repository's [CONTRIBUTING.md](https://github.com/Ryu-CZ/pi-reasoning-zip/blob/main/CONTRIBUTING.md) for smoke tests, development commands, source loading, package inspection, and the release checklist.
