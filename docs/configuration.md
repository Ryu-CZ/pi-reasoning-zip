# Configuration

Settings live under the `reasoningZip` object in project `.pi/settings.json` or global `~/.pi/agent/settings.json`. If `PI_CODING_AGENT_DIR` is set, its `settings.json` replaces `~/.pi/agent/settings.json` as the global file.

The extension rereads settings for every relevant hook. Global values are merged recursively with project values, so a project can override one nested field without repeating its siblings. `footerStatus` is the exception: it is read only from the global file so one project cannot change the shared Pi footer. A missing or unreadable settings section behaves like an empty section. Invalid values fall back to the built-in value; an invalid project value does not reveal an overridden global value.

## Complete reference

| Setting | Type | Built-in default | Behavior |
|---|---|---|---|
| `enabled` | boolean | `true` | Enables compaction. |
| `mode` | string | `local-only` | Selects providers eligible for extension behavior. |
| `footerStatus` | string | `🗜️ Zip` | Text shown in Pi's footer while enabled; read from global settings only. |
| `llamaCppSlots.enabled` | boolean or `"auto"` | `false` | Controls opt-in llama.cpp slot pinning. |
| `llamaCppSlots.mainIdSlot` | non-negative integer | `0` | Slot ID for targeted main Pi requests. |
| `llamaCppSlots.compactorIdSlot` | non-negative integer | `1` | Slot ID for compactor requests. |
| `compactor.baseUrl` | string | `http://127.0.0.1:7484/v1` | OpenAI-compatible API base URL; trailing slashes are removed. |
| `compactor.model` | string | `unsloth` | Model sent in compactor requests. |
| `compactor.apiKey` | string | `sk-placeholder` | Bearer token for compactor requests and `/slots` probes. |
| `compactor.maxCompactionRatio` | fraction greater than 0 and at most 1 | `1` | Sets the maximum per-input output budget using estimated input tokens. |
| `compactor.temperature` | non-negative number | `0.1` | Compactor sampling temperature. |
| `compactor.timeoutMs` | number, at least 1 | `30000` | Compactor request timeout in milliseconds. |
| `thresholds.minChars` | non-negative number | `1000` | Minimum reasoning-block length eligible for compaction. |
| `thresholds.fallbackMaxInputChars` | number, at least 1 | `50000` | Source-character limit only when compactor context metadata is unavailable. |
| `thresholds.maxTraceChars` | `-1` or number at least 1 | `-1` | Optional maximum accepted compact reasoning length; `-1` disables this guardrail. |

Invalid enum values and values outside the accepted type or numeric range fall back to their built-in defaults.

## Example

This recommended shared llama.cpp-server example is not a dump of built-in defaults:

```json
{
  "reasoningZip": {
    "enabled": true,
    "mode": "local-only",
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
      "maxCompactionRatio": 1,
      "temperature": 0.1,
      "timeoutMs": 30000
    },
    "thresholds": {
      "minChars": 1000,
      "fallbackMaxInputChars": 50000,
      "maxTraceChars": -1
    }
  }
}
```

## Field details

### `enabled`

Master on/off switch for the extension. It exists so `/reasoning-zip enable`, `disable`, and `toggle` can change behavior without destroying the rest of the configuration.

- `true`: allow targeting, compaction, and optional slot handling according to the other fields; show `footerStatus`.
- `false`: do not target or compact messages and do not inject slot fields; clear the footer status.

This is the only on/off control. The older `mode: "disabled"` and `storageMode: "off"` controls were removed because they produced the same result.

### `mode`

Limits which providers the extension may touch. This exists to avoid sending private reasoning from an unintended provider to the configured compactor.

| Value | Exact targeting behavior |
|---|---|
| `local-only` | Accept provider IDs that are local URLs using `localhost`, `127.0.0.1`, `::1`, or `0.0.0.0`, including a local URL after the `llama-server=` prefix. This is the default. |
| `llama-only` | Accept provider IDs beginning with `llama-server=` or containing `llama.cpp`/`llamacpp`, regardless of whether their URL is local. |
| `all` | Accept any provider, including hosted providers. Use only when intentionally allowing their plain thinking blocks to be sent to `compactor.baseUrl`. |

An absent or unrecognized provider is skipped by `local-only` and `llama-only`, but accepted by `all`. Every mode still requires an assistant message, an eligible plain thinking block, and passing thresholds. Compaction is always forward-only: it never rewrites earlier session entries, backfills the current session, or modifies replayed context.

### `footerStatus`

Text shown through Pi's footer status API while the extension is enabled. It exists as a small visual reminder that future eligible reasoning will be compacted.

Only the global value is used; a project `footerStatus` is deliberately ignored. The value must be a non-empty string. Disabling the extension or ending the session clears the status.

### `llamaCppSlots.enabled`

Controls whether main Pi requests and compactor requests are assigned separate llama.cpp `id_slot` values. It exists because an unpinned compactor request on a shared server can replace the main conversation's reusable KV cache.

| Value | Behavior and responsibility |
|---|---|
| `false` | Do not add slot fields or probe `/slots`. Default and most compatible, but offers no cache isolation on a shared server. |
| `"auto"` | For a shared eligible endpoint, authenticate to `GET /slots`, verify at least two slots and non-colliding IDs, then pin both requests. Unsafe or ambiguous shared-server state skips compaction and preserves the original reasoning. Different known endpoints compact without pinning. |
| `true` | Force slot pinning without probing. Use only when the server supports llama.cpp slot fields and you manage its topology. |

Auto mode's request-bound checks also fail closed if settings change mid-generation, request correlation is missing or ambiguous, or an existing explicit main slot conflicts. See [llama.cpp slot pinning](llama-cpp-slot-pinning.md).

### `llamaCppSlots.mainIdSlot`

Non-negative integer sent as `id_slot` on a targeted main Pi request when pinning is active. It exists to keep the growing conversation in a stable slot. The extension also adds `cache_prompt: true` unless the request already set it, but never overwrites an existing `id_slot`.

llama.cpp wraps IDs modulo the actual slot count, so numerically different IDs can still collide. Auto mode checks the normalized value; forced mode can only check direct equality and leaves topology correctness to you.

### `llamaCppSlots.compactorIdSlot`

Non-negative integer sent as `id_slot` on the separate compactor request when pinning is active. It exists to prevent that short request from occupying the main conversation's slot. Compactor requests also set `cache_prompt: true`.

It must resolve to a different actual slot than `mainIdSlot` and any explicit main-request `id_slot`. A direct conflict throws before the compactor request in forced mode; auto mode detects modulo collisions and preserves the original reasoning.

### `compactor.baseUrl`

Base URL of the OpenAI-compatible server that performs compaction. The extension sends `POST {baseUrl}/chat/completions`; trailing slashes are removed when settings are resolved.

This field exists so compaction can use a small or local model independently of the main Pi model. It also participates in shared-server detection for llama.cpp slot isolation: URLs are compared after removing a trailing `/v1`. Use the API root ending in `/v1`, not the full `/chat/completions` path.

### `compactor.model`

Model identifier placed in the compactor request body. It exists because OpenAI-compatible servers route requests by their configured model name or alias. The extension does not discover models or verify this name in advance; an unknown name becomes an endpoint error and the original reasoning is preserved.

### `compactor.apiKey`

Bearer token sent in the `Authorization` header for compactor requests. Auto slot mode also uses the same token for `GET /slots` probes.

The placeholder default is suitable only for local servers that ignore authentication or accept that token. Set the real credential when the endpoint requires one, keep settings files private, and remember that project settings may override the global token.

### `compactor.maxCompactionRatio`

Maximum generated-output budget as a fraction of the estimated source reasoning tokens. It exists to scale the compactor budget with each input instead of using one fixed token cap for short and long traces.

The accepted range is greater than `0` and at most `1`. For a thinking block whose JavaScript string `.length` is `C`, the request uses:

```text
estimatedInputTokens = ceil(C / 3)
max_tokens = ceil(estimatedInputTokens * maxCompactionRatio)
```

At the default `1`, an 8,000-character trace is estimated as 2,667 input tokens and receives `max_tokens: 2667`. The conservative `C / 3` conversion is still approximate, especially for code and non-English text. This field limits generation; it does not promise the result will use the whole budget or have that output ratio. The result must still be shorter than the source; it is also limited by `thresholds.maxTraceChars` when that optional guardrail is enabled. A response stopped by the token limit is rejected as truncated, preserving the original. In the comparative local benchmark, the selected prompt completed 0/6 tuning traces at `0.25` and `0.5`, 3/6 at `0.75`, and 6/6 at `1`. The previous `C / 4` estimate underbudgeted punctuation- and code-dense traces.

### `compactor.temperature`

Non-negative sampling temperature sent directly to the compactor endpoint. It exists to control output variability. Lower values generally make ledger formatting and retention more repeatable; higher values permit more variation and can make exact-format compliance less predictable.

The extension does not impose an upper limit because OpenAI-compatible endpoints differ. A value accepted by settings can still be rejected by the server, in which case compaction fails open and preserves the original reasoning.

### `compactor.timeoutMs`

Maximum time in milliseconds allowed for the compactor operation. It exists so a side request cannot delay completion indefinitely. The default is 30 seconds.

The timer covers the initial request and the compatibility retry together. On timeout the request is aborted, the original reasoning is preserved, and Pi shows a warning. Very low values can fail healthy local models during prompt evaluation.

### `thresholds.minChars`

Minimum source thinking-block length, measured by JavaScript string `.length` (UTF-16 code units), eligible for a compactor request. It exists to avoid spending latency and compute on short traces where the savings are small and secondary-detail loss is more likely.

The comparison is inclusive: a block exactly `minChars` long is eligible. `0` permits empty-length candidates in principle, although empty or non-useful compactions still fail validation. This threshold is evaluated independently for every thinking block in a message.

### `thresholds.fallbackMaxInputChars`

Fallback maximum source thinking-block length, measured by JavaScript string `.length` (UTF-16 code units). It applies only when the configured compactor endpoint cannot report the selected model's context through `GET {baseUrl}/models` as `data[].meta.n_ctx`. The default is 50,000 characters.

When metadata is available, the extension calculates the source limit instead:

```text
sourceTokenLimit = floor((contextTokens - 1024) / (1 + maxCompactionRatio))
sourceCharacterLimit = sourceTokenLimit * 3
```

This reserves 1,024 tokens for compaction instructions and accounts for the ratio-derived output budget. At a 53,504-token context and ratio `1`, it permits 78,720 source characters. The discovered context (including an unavailable result) is cached for five minutes per compactor URL and model. If metadata is missing or the probe fails, the positive fallback limit prevents an unbounded request. A source over the applicable limit is skipped and retained unchanged; it is not truncated.

### `thresholds.maxTraceChars`

Optional maximum accepted compacted-output length, measured by JavaScript string `.length` (UTF-16 code units). The default `-1` disables this guardrail, so a valid compact result is stored whenever it is strictly shorter than its source. Set a positive value to impose an additional storage-size bound independent of the request's token budget.

With a positive value, an output exceeding it is rejected and the original reasoning remains. In either mode, the output must be non-empty, not exactly `none`, complete, free of inline reasoning wrappers, and strictly shorter than its source. This is an acceptance check after generation, not an instruction to the model and not a token limit; choose a positive value only when you want that trade-off.

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

The prompt treats dead ends as durable state: a rejected option is not reduced to “failed,” because its evidence, cannot-use conclusion, and source-stated reconsideration condition prevent a later agent from repeating the same work. It combines the typed ledger with selective surface deletion, while retaining exact strings, values, units, causal order, and alternatives. Instructions quoted or described inside the source are omitted rather than followed or repeated. If no useful state remains, `none` causes the original reasoning to remain unchanged; the compactor is also told never to include the prompt's own instruction text in its output.

The extension preserves the original reasoning if the request fails or the response is empty, `none`, contains inline reasoning wrappers, is truncated, or is not shorter than the original. It also preserves the original when an enabled positive `thresholds.maxTraceChars` guardrail is exceeded.

## Tuning guidance

The prompt comparison used traces around 2,000 characters and direct exact-source requests. It did not establish that shorter traces are worth the added request, so the built-in `minChars: 1000` remains unchanged. See [Benchmark](benchmark.md).

Tune `minChars` first to decide which traces are worth compacting. Then choose `maxCompactionRatio` for generation headroom and optionally enable a positive `maxTraceChars` guardrail when you want a fixed largest stored result. The automatic source limit uses compactor context metadata when available; choose `fallbackMaxInputChars` for endpoints that do not provide it. Measure retention on exact source traces: independent live generations vary and are not a controlled compression comparison.

## Longer main-model reasoning (llama.cpp)

This extension does not make the main model reason longer. For a llama.cpp/Qwen benchmark, configure the **main server**, not the compactor, with reasoning enabled and an explicit finite thinking budget, for example:

```bash
llama-server \
  --reasoning on \
  --reasoning-preserve \
  --reasoning-budget 8192 \
  --parallel 3 --kv-unified --slots
```

`--reasoning-budget` caps hidden reasoning tokens; it is independent of this extension's `compactor.maxCompactionRatio`. If Pi or its llama.cpp integration sends `thinking_budget_tokens`, use a matching or lower main-request budget (the live stress check used `8192`) and keep the compactor at `thinking_budget_tokens: 0`. When using shared slots, pin main traffic to slot 0 and compaction to slot 1.

Longer source reasoning can exceed the automatically derived source limit (or `fallbackMaxInputChars` when context metadata is unavailable), in which case the extension skips it and preserves the original. With a positive `maxTraceChars` guardrail, it can also produce a faithful compact result longer than that value, in which case validation rejects it and preserves the original. Do not enable or raise either threshold merely to improve a benchmark headline; choose them only after evaluating the latency, storage, and retention trade-off. The two-run 8,192-token local stress check and its raw output are documented in [Benchmark](benchmark.md#live-high-reasoning-stress-check).
