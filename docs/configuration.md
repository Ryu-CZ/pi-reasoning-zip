# Configuration

Settings live under `reasoningZip` in project `.pi/settings.json` or global `~/.pi/agent/settings.json`. Project values override global values recursively. `footerStatus` is the exception: the extension reads it only from global settings.

## Complete reference

| Setting | Type | Built-in default | Behavior |
|---|---|---|---|
| `enabled` | boolean | `true` | Enables compaction. |
| `mode` | string | `local-only` | Selects providers eligible for extension behavior. |
| `storageMode` | string | `compact-new` | Controls whether new assistant reasoning is compacted before storage. |
| `compressionRole` | string | `grug` | Selects the compactor's requested output style. |
| `footerStatus` | string | `🗜️ Zip` | Text shown in Pi's footer while enabled; read from global settings only. |
| `llamaCppSlots.enabled` | boolean or `"auto"` | `false` | Controls opt-in llama.cpp slot pinning. |
| `llamaCppSlots.mainIdSlot` | non-negative integer | `0` | Slot ID for targeted main Pi requests. |
| `llamaCppSlots.compactorIdSlot` | non-negative integer | `1` | Slot ID for compactor requests. |
| `compactor.baseUrl` | string | `http://127.0.0.1:7484/v1` | OpenAI-compatible API base URL; trailing slashes are removed. |
| `compactor.model` | string | `unsloth` | Model sent in compactor requests. |
| `compactor.apiKey` | string | `sk-placeholder` | Bearer token for compactor requests and `/slots` probes. |
| `compactor.maxCompactionRatio` | fraction greater than 0 and at most 1 | `0.25` | Sets the maximum per-input output budget using estimated input tokens. |
| `compactor.temperature` | non-negative number | `0.1` | Compactor sampling temperature. |
| `compactor.timeoutMs` | number, at least 1 | `30000` | Compactor request timeout in milliseconds. |
| `thresholds.minChars` | non-negative number | `1000` | Minimum reasoning-block length eligible for compaction. |
| `thresholds.maxInputChars` | number, at least 1 | `50000` | Maximum reasoning-block length eligible for compaction. |
| `thresholds.maxTraceChars` | number, at least 1 | `2000` | Maximum accepted compact reasoning length. |

Invalid enum values and values outside the accepted type or numeric range fall back to their built-in defaults.

## Example

This recommended shared llama.cpp-server example is not a dump of built-in defaults:

```json
{
  "reasoningZip": {
    "enabled": true,
    "mode": "local-only",
    "storageMode": "compact-new",
    "compressionRole": "grug",
    "footerStatus": "🗜️ Zip",
    "llamaCppSlots": {
      "enabled": "auto",
      "mainIdSlot": 0,
      "compactorIdSlot": 1
    },
    "compactor": {
      "baseUrl": "http://127.0.0.1:8080/v1",
      "model": "Qwen3.6-27B",
      "apiKey": "sk-placeholder",
      "maxCompactionRatio": 0.25,
      "temperature": 0.1,
      "timeoutMs": 30000
    },
    "thresholds": {
      "minChars": 1000,
      "maxInputChars": 50000,
      "maxTraceChars": 2000
    }
  }
}
```

## Modes

| Mode | Behavior |
|---|---|
| `llama-only` | Target llama.cpp-like providers only. |
| `local-only` | Target local URL providers and local `llama-server=` endpoints only. |
| `all` | Target any eligible plain Pi thinking block. |
| `disabled` | Disable compaction. |

Unknown providers are skipped in `llama-only`; hosted or non-local providers are skipped in `local-only`.

## Storage modes

| Storage mode | Behavior |
|---|---|
| `compact-new` | Compact eligible new assistant thinking before Pi stores it. |
| `off` | Do not alter assistant messages. |

Storage is forward-only. No mode rewrites previous sessions, backfills the current session, or mutates replayed context through Pi's `context` hook.

## Compression roles

| Role | Behavior |
|---|---|
| `balanced` | Request concise bullets while preserving additional context. |
| `grug` | Request terse, keyword-heavy output. This is the default. |
| `ultra-grug` | Request the most aggressive fragment-style trace. |

The compactor is asked to retain facts, decisions, constraints, failed approaches, and next actions. The role changes that requested style; acceptance checks remain the same.

## Compactor endpoint

The compactor must expose:

```text
POST {baseUrl}/chat/completions
```

The first request includes `chat_template_kwargs: { "enable_thinking": false }` and `thinking_budget_tokens: 0`, which asks llama.cpp/Qwen-style models to put the compact trace in `message.content` instead of producing compactor-side reasoning. If a stricter OpenAI-compatible endpoint rejects those fields with HTTP 400 or 422, the extension retries once without them.

Expected output is a terse atomic state ledger:

```text
F: exact fact or event
C: constraint
D: decision and why
X: attempted approach -> result/evidence -> why it cannot be used -> when to reconsider
U: uncertainty, unproven hypothesis, or provisional status
R: rollback or abort condition
O: open question or success test
N: next action
```

The prompt treats dead ends as durable state: a rejected option is not reduced to “failed,” because its evidence, cannot-use conclusion, and reconsideration condition prevent a later agent from repeating the same work. It asks the compactor to remove only repetition, self-talk, and grammar while retaining exact strings, values, units, causal order, and every alternative. If no useful state remains, `none` causes the original reasoning to remain unchanged; the compactor is also told never to include the prompt's own instruction text in its output.

The extension preserves the original reasoning if the request fails or the response is empty, `none`, contains inline reasoning wrappers, is truncated, is not shorter than the original, or exceeds `thresholds.maxTraceChars`.

Each request uses `ceil(ceil(input characters / 4) * maxCompactionRatio)` as its output token budget. The character-to-token estimate is approximate, especially for code and non-English text.

## Thresholds

`minChars` avoids spending a compactor request on short reasoning blocks. `maxInputChars` bounds compactor input. `maxTraceChars` bounds accepted output independently of the ratio-based token budget.

The benchmark used `minChars: 400` to test aggressive coverage; that is not the built-in default. It compacted short traces but required two extra requests to save 243 characters across the two shortest tasks, and one result lost secondary context. See [Benchmark](benchmark.md).

## Slot settings

Slot pinning is disabled by default. Use `"auto"` for a shared llama.cpp endpoint when `/slots` is available; use `true` only with a topology you manage. See [llama.cpp slot pinning](llama-cpp-slot-pinning.md).
