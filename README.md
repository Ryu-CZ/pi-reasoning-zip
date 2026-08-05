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

## Results

A controlled five-task local benchmark sent each exact source trace to the same compactor. This isolates storage reduction from independent generation variance.

| Task | Original thinking | Compact thinking | Change | Retention result |
|---|---:|---:|---:|---|
| Incident rollback plan | 1,261 chars | 378 chars | -70.0% | All supplied facts, thresholds, path, command, and migration constraint retained |
| Double-charge debugging | 3,934 chars | 830 chars | -78.9% | Claim/retry design and failed approaches retained; some API-idempotency nuance condensed |
| Sliding-window algorithm | 2,079 chars | 560 chars | -73.1% | Algorithm, inclusive boundary, correctness argument, and complexity retained |
| Redis-to-PostgreSQL migration | 467 chars | 349 chars | -25.3% | All explicit migration constraints retained |
| Inference-service decision | 599 chars | 474 chars | -20.9% | Hard constraints and option data retained; workload and TTFT details were omitted |
| **Total** | **8,340 chars** | **2,591 chars** | **-68.9%** | Core continuation state retained, with greater detail loss in the shortest trace |

These are measured local storage results, not universal compression rates. The estimated 30–60 seconds to rebuild a lost 60k-token prompt is an extrapolation, not a measured long-context result. See [Benchmark](docs/benchmark.md) for the environment, methodology, slot verification, all observations, and limitations.

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

Enable the extension and inspect the effective toggle source:

```text
/reasoning-zip enable
/reasoning-zip status
```

## Commands

```text
/reasoning-zip status
/reasoning-zip enable [global|project]
/reasoning-zip disable [global|project]
/reasoning-zip toggle [global|project]
```

Without a scope, writes update the nearest existing `reasoningZip` settings section and otherwise use global settings. Settings are reread for each hook call, so toggles affect subsequent compaction. When enabled, Pi's footer shows the global `reasoningZip.footerStatus` value (`🗜️ Zip` by default).

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
- The extension skips non-assistant messages, non-array content, blocks outside configured size thresholds, and providers excluded by the selected mode. Tool-call blocks are preserved while eligible thinking blocks in the same message are compacted.
- It skips signed, encrypted, redacted, and provider-opaque reasoning. Pi's `thinkingSignature: "reasoning_content"` is treated as plain llama.cpp reasoning, not an opaque signature.
- A compact result is rejected when it is empty, `none`, not shorter than the source, or longer than `maxTraceChars`. Inline reasoning wrappers and truncated compactor output are also rejected.
- It does not reduce hidden provider-side reasoning tokens. It adds a compactor request and may lose secondary detail, especially on short traces.
- The extension never modifies the main model's system, developer, user, or assistant messages before generation. Its `before_provider_request` hook is used only for optional llama.cpp slot fields.

## Troubleshooting

| Symptom | Check |
|---|---|
| No block was compacted | Confirm the message is from the assistant, has array content, meets `minChars`/`maxInputChars`, and is eligible for the selected `mode`. |
| Original reasoning was preserved | Check Pi warnings and compactor output. Errors, empty/`none` output, longer output, and output over `maxTraceChars` are rejected. |
| Auto slot mode skips compaction | Verify `GET /slots` succeeds with the compactor API key, reports at least two slots, and configured IDs do not collide after wrapping. |
| Next llama.cpp turn reprocesses too much prompt | Confirm main and compactor requests use different slots. The first turn after compaction still evaluates the changed suffix by design. |
| `local-only` skips a custom provider | Confirm Pi exposes it as a local URL provider or `llama-server=` endpoint; otherwise choose a mode that targets it intentionally. |

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for smoke tests, development commands, source loading, package inspection, and the release checklist.
