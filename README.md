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

Compress reasoning blocks to keep the context short.

**WARNING: Extension trades token and latency for shorter context!**


## Why

There are `thinking` blocks in your Pi session filling your context window. But there is a major difference between **open** and **closed** models.
- Hosted providers of **closed models** usually keep full internal reasoning inside the API and expose only final response and summarized opaque `thinking` block. 
- The _**open reasoning models**_ usually expose the whole `thinking` block to Pi.

`pi-reasoning-zip` compresses _**open reasoning model**_ `thinking` blocks into a caveman-style compact thinking block before they are stored in the session.
- caveman-ed compaction costs additional tokens but reduces context usage
- intentional usage of `pi-reasoning-zip` is when your Pi is using local model, in which case your `reasoningZip.compactor` is often the same as your active Pi model


<p align="center">
  <img src="https://raw.githubusercontent.com/Ryu-CZ/pi-reasoning-zip/main/media/diagram-zip-flow.svg" alt="reasoning context of closed and open llm" />
</p>


### Compaction effectiveness

From my [local benchmark](#local-benchmark)

| Metric across 7 sessions | Normal | Zip ON | Change |
|---|-------:|-------:|---:|
| Stored thinking characters | 15,242 |  4,631 | -69.6% |
| Complete session JSONL bytes | 57,902 | 49,317 | -14.8% |


## Install


From npm:
```bash
pi install npm:pi-reasoning-zip
```

From git
```bash
pi install git:github.com/Ryu-CZ/pi-reasoning-zip
```



## Commands

`pi-reasoning-zip` registers a Pi command for toggling the `reasoningZip.enabled` setting:

```text
/reasoning-zip status
/reasoning-zip enable [global|project]
/reasoning-zip disable [global|project]
/reasoning-zip toggle [global|project]
```

Without an explicit scope, writes update the nearest existing `reasoningZip` settings section, falling back to global Pi settings. The extension rereads settings for each hook call, so enable/disable affects subsequent compaction and prompt-injection events. When enabled, Pi's footer shows `reasoningZip.footerStatus` from global settings, defaulting to `🗜️ Zip`.


## Features

- **Forward-only compaction** — modifies only the new assistant message being finalized.
- **Stored compact traces** — future turns naturally replay compact `thinking` because that is what Pi stored.
- **Local compactor** — calls a configured OpenAI-compatible `/chat/completions` endpoint directly.
- **llama.cpp-first targeting** — defaults to llama.cpp-like providers such as `llama-server=http://127.0.0.1:8080`.
- **Prompt minimization** — optional grug-style request injection for target local providers.
- **Fail-open safety** — preserves original messages on errors, timeouts, invalid output, or unknown payloads.
- **Opaque reasoning guard** — skips signed, encrypted, redacted, or provider-opaque reasoning metadata while allowing llama.cpp's plain `reasoning_content` traces.


## Configuration

Settings live in project `.pi/settings.json` or global `~/.pi/agent/settings.json` under the `reasoningZip` key. Project settings take precedence.

Example configuration for a shared local llama.cpp server (slot pinning is opt-in, so this is not a dump of built-in defaults):

```json
{
  "reasoningZip": {
    "enabled": true,
    "mode": "local-only",
    "storageMode": "compact-new",
    "compressionRole": "grug",
    "injectPrompt": true,
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
      "maxTokens": 512,
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

`footerStatus` is read from global settings only; project settings can still control compaction behavior.



### Modes

| Mode | Behavior |
|---|---|
| `llama-only` | Compact llama.cpp-like providers only |
| `local-only` | Compact local URL providers and local `llama-server=` endpoints only |
| `all` | Compact any eligible plain Pi `thinking` block |
| `disabled` | No-op |

### Storage modes

| Storage mode | Behavior |
|---|---|
| `compact-new` | Compact new assistant thinking before storage |
| `off` | Do not alter assistant messages |

### Compression roles

| Role | Behavior |
|---|---|
| `balanced` | concise bullets while preserving extra context |
| `grug` | terse, keyword-heavy default |
| `ultra-grug` | most aggressive fragment-style trace |

## llama.cpp slot pinning

By default, Pi does not send llama.cpp's `id_slot` field, so llama.cpp treats main requests as `id_slot: -1` and auto-selects a slot. This extension cannot inspect the final auto-assigned slot through Pi's `before_provider_request` hook; it can only see and preserve an explicit `id_slot` already present in the outgoing payload.

Slots matter because llama.cpp stores each request's evaluated prompt and generated tokens in a slot's KV cache. That cache is what makes the next turn fast: the server can reuse the long common prefix of the conversation instead of re-processing it. A reasoning-zip compaction call is a second, unrelated chat completion request. If llama.cpp auto-selects the same slot for that short compaction request, the slot's cached main conversation state can be truncated or replaced by the compactor prompt/output. On the following user turn, the main conversation may lose its prompt-cache/KV-cache hit and pay the full prompt processing cost again.

`--parallel N` creates N llama.cpp slots. With `--parallel 2` or higher, the main conversation and the compactor can be isolated by pinning them to different `id_slot` values. With only one slot, both requests must share the same KV state, so pinning cannot prevent invalidation.

**Built-in default is `llamaCppSlots.enabled: false` (opt-in).** Slot pinning is disabled by default to maintain compatibility with servers that don't support it.

### Recommended llama.cpp server settings

For a main Pi model and reasoning compactor sharing one llama.cpp server, use this cache-isolation baseline in addition to your model and hardware-specific options:

```bash
llama-server \
  --model /path/to/Qwen3.6-27B.gguf \
  --alias Qwen3.6-27B \
  --parallel 2 \
  --kv-unified \
  --no-cache-idle-slots \
  --slots
```

The cache-relevant options are:

| llama.cpp option | Why it is recommended |
|---|---|
| `--parallel 2` | Creates separate slots for Pi (`id_slot: 0`) and the compactor (`id_slot: 1`). Two is the minimum; use more only for other concurrent workloads. |
| `--kv-unified` | Lets the long Pi conversation and short compactor request share the total KV capacity dynamically instead of splitting it equally between slots. |
| `--no-cache-idle-slots` | Prevents starting the compactor from saving and clearing Pi's idle slot in unified-KV mode. |
| `--slots` | Keeps `GET /slots` available so `llamaCppSlots.enabled: "auto"` can verify the actual slot count. The endpoint is currently enabled by default, but setting it explicitly documents the dependency. |

Keep the server on a trusted interface such as `127.0.0.1`; `/slots` exposes runtime information. Model path, context size, GPU offload, flash attention, sampling, and speculative-decoding flags depend on your hardware and model and are intentionally not prescribed here.

After startup, verify that llama.cpp reports at least two slots:

```bash
curl -sS http://127.0.0.1:8080/slots
```

The response should be a JSON array containing at least two entries with distinct IDs, normally `0` and `1`.

Unified KV is recommended when the Pi conversation is much longer than the reasoning block being compacted because either slot can use the available capacity. Keep enough total KV headroom for both requests: if the main conversation fills the entire cache, llama.cpp may still need to purge idle state to run the compactor.

For strict fixed-partition isolation, replace `--kv-unified` with `--no-kv-unified`. The configured `--ctx-size` is then divided evenly across the slots, so `--parallel 2` gives each slot half of the total capacity; unused compactor capacity cannot be borrowed by Pi.

### Extension settings

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

This is the recommended shared-server configuration, not the built-in default. Set `llamaCppSlots.enabled` to `"auto"` to enable pinning only when the main provider and compactor share the same llama.cpp server endpoint (after normalizing a trailing `/v1`), `GET /slots` reports at least two slots, and the configured IDs do not collide. Set it to `true` to force pinning without probing only when you guarantee valid distinct slots, or `false` to disable pinning. The `/slots` endpoint is enabled by default in current llama.cpp but can be disabled with `--no-slots`.

### Behavior and safeguards

**Auto mode fails closed for shared servers:** if the probe fails, the slot count is less than 2, or the configured IDs collide modulo the slot count (e.g., IDs 0 and 2 with 2 slots), the compactor request is skipped entirely, the original reasoning is preserved, and a UI warning is shown. This is not treated as a compaction failure. Different main/compactor endpoints remain safe and compact normally without pinning. Forced `true` remains user-managed.

**ID wrapping:** llama.cpp wraps slot IDs modulo the slot count. Auto mode normalizes configured IDs and detects collisions (e.g., `mainIdSlot: 0` and `compactorIdSlot: 2` collide with 2 slots since `2 % 2 = 0`). Explicit main `id_slot` values are also checked modulo the slot count.

When slot pinning is active, the `before_provider_request` hook adds `id_slot: mainIdSlot` and `cache_prompt: true` to targeted main Pi requests that do not already contain `id_slot`. Existing explicit `id_slot` values are never overwritten; if an explicit main request uses the configured compactor slot, the extension warns. Compactor calls send `id_slot: compactorIdSlot` and `cache_prompt: true`.

Each eligible shared-server main request in auto mode gets a fresh `/slots` probe using the configured compactor API key (concurrent probes are deduplicated). The resulting decision is retained for that request and consumed by its `message_end`, so the compactor cannot run under a different slot assumption than the main request. If slot settings change during generation, no matching request decision is available, or same-provider requests overlap and cannot be correlated safely, the original reasoning is preserved.

Use `id_slot`, not the older/incorrect `slot_id` name. With `--parallel 1`, slot IDs wrap to the only slot and cannot prevent cache invalidation; use a separate compactor server or llama.cpp slot save/restore instead. `cache_prompt: false` is not an ephemeral/no-store mode and can clear the selected slot's reusable state.

## Compactor endpoint

The compactor must expose an OpenAI-compatible chat completions endpoint:

```text
POST {baseUrl}/chat/completions
```

The extension first sends `chat_template_kwargs: { "enable_thinking": false }` and `thinking_budget_tokens: 0` so llama.cpp/Qwen-style compactor calls return the compact trace in `message.content` instead of spending tokens on compactor-side reasoning. If a stricter OpenAI-compatible endpoint rejects those fields with HTTP 400/422, the request is retried once without them.

The extension asks the compactor to produce terse output like:

```text
facts:
- ...
decisions:
- ...
constraints:
- ...
failed:
- ...
next:
- ...
```

The configured `compressionRole` guides the compactor's terse style. If the compactor returns `none`, empty output, inline reasoning wrappers, truncated output, output longer than the original, or output over `thresholds.maxTraceChars`, the original block is preserved.

## Safety model

This extension does **not**:

- rewrite previous sessions
- backfill older entries in the current session
- mutate replayed context with the `context` hook
- claim to reduce hidden provider-side reasoning tokens
- touch signed, encrypted, or opaque provider reasoning metadata

It skips:

- non-assistant messages
- messages without array content
- short thinking below `thresholds.minChars`
- thinking above `thresholds.maxInputChars`
- assistant messages that include tool calls
- cryptographically signed, encrypted, or redacted thinking blocks
- unknown providers by default in `llama-only`
- hosted/non-local providers in `local-only`

If a compactor request fails, the extension preserves the original reasoning and sends a Pi warning notification.

## Local Benchmark

On 2026-08-01, five reasoning-heavy tasks were run with Pi `0.83.0` and this
extension at `0.5.0` against a local 27B Qwen3.6-derived Q4 model served by
llama.cpp. The server exposed an 83,968-token context with two unified-KV slots.
The same model (`unsloth`) handled both the main response and compaction.

The test isolated the two arms completely:

- **Baseline:** core Pi with no extensions.
- **Treatment:** core Pi plus only `pi-reasoning-zip` loaded from this checkout.
- Both arms disabled tools, skills, prompt templates, and context files.
- Both used fresh one-turn sessions, the same prompts, model, and thinking level.
- `injectPrompt: false` kept the extension from changing the main model prompt.

The tested storage settings were:

```json
{
  "compressionRole": "grug",
  "injectPrompt": false,
  "compactor": { "maxTokens": 512, "temperature": 0.1 },
  "thresholds": {
    "minChars": 400,
    "maxInputChars": 20000,
    "maxTraceChars": 2000
  }
}
```

Because local sampling produced different reasoning lengths between independent
live requests, raw enabled/disabled totals would mix generation variance with
compression. For the controlled storage and quality comparison, each exact
baseline trace was therefore sent to the same configured compactor:

| Task | Original thinking | Compact thinking | Change | Retention result |
|---|---:|---:|---:|---|
| Incident rollback plan | 1,261 chars | 378 chars | -70.0% | All supplied facts, thresholds, path, command, and migration constraint retained |
| Double-charge debugging | 3,934 chars | 830 chars | -78.9% | Claim/retry design and failed approaches retained; some API-idempotency nuance condensed |
| Sliding-window algorithm | 2,079 chars | 560 chars | -73.1% | Algorithm, inclusive boundary, correctness argument, and complexity retained |
| Redis-to-PostgreSQL migration | 467 chars | 349 chars | -25.3% | All explicit migration constraints retained |
| Inference-service decision | 599 chars | 474 chars | -20.9% | Hard constraints and option data retained; workload and TTFT details were omitted |
| **Total** | **8,340 chars** | **2,591 chars** | **-68.9%** | Core continuation state retained, with greater detail loss in the shortest trace |

The 400-character threshold successfully compacted all five traces, including
live Pi storage checks for the two short task classes. Its tradeoff is visible:
the two shortest traces required two extra model requests to save only 243
characters, and one lost secondary context. A higher threshold reduces those
requests; 400 favors aggressive coverage.

### Slot-isolation verification

A live auto-mode run sampled llama.cpp's `/slots` endpoint every 100 ms and
correlated 413 samples with `llama-think.service` logs:

| Request | Slot | llama.cpp task | Duration | Observed request shape |
|---|---:|---:|---:|---|
| Main Pi generation | 0 | 1124 | 17.53 s | Streaming, temperature 0.59375, 4,400-token limit |
| Reasoning compactor | 1 | 1901 | 1.77 s | Non-streaming, temperature 0.1, 512-token limit |

The logs showed explicit selection by ID: the main request used slot 0, released
it, and the compactor then used slot 1. There was no slot collision, and the
resulting session stored a valid compact trace. On this run the main model
generated about 77.7 tokens/s and the compactor about 102.5 tokens/s. These are
host-specific observations, not general performance claims.

A separate multi-turn run tested whether compaction preserved the main prompt
cache across a following Pi turn:

| Stage | Slot | Prompt tokens newly evaluated | Approximate cached prefix reused |
|---|---:|---:|---:|
| Initial main turn | 0 | 504 | N/A |
| Compactor | 1 | 275 | Separate slot; slot 0 untouched |
| First main turn after compaction | 0 | 950 | 524 tokens (about 35.5% of its prompt) |
| Repeated follow-up | 0 | 54 | 1,578 tokens (about 96.7% of its prompt) |

The compactor did not overwrite slot 0. The first following turn could reuse the
unchanged conversation prefix, but it still had to evaluate the suffix where the
stored compact reasoning differed from the originally generated reasoning. Once
slot 0 contained that compact replay form, the next turn reused nearly the whole
prompt. Slot isolation therefore prevents **wholesale** cache invalidation; it
cannot prevent the intentional reasoning rewrite from changing part of the
prompt.

This distinction becomes important for long sessions. At the observed local
prompt-processing range of roughly 1,000-2,000 tokens/s, rebuilding a completely
lost 60k-token prompt would take approximately 30-60 seconds. Preserving its
prefix and evaluating only a 1k-3k-token changed suffix would take roughly 1-3
seconds, before normal output generation. These figures are an extrapolation,
not a measured 60k-token benchmark, and actual throughput may fall with long
contexts. The server's 83,968-token unified KV pool is also shared: a 60k-token
main cache plus a modest compactor request has useful headroom, while operation
near the context limit may still force eviction.

The compression table remains primarily a **storage and retention benchmark**.
Compaction adds another model request; cache-retention savings occur on later
turns and depend on session length, prefix similarity, and available unified KV.
The repository's isolated automated suite passed 89/89 tests after the live
checks.

## Smoke tests

Automated local smoke test:

```bash
npm run smoke
```

This loads `dist/index.js`, registers the Pi hooks against a mock extension API, uses a temporary `.pi/settings.json`, mocks the OpenAI-compatible compactor, and verifies thinking compaction plus targeted prompt injection.

Manual Pi smoke test:

1. Start a local llama.cpp/OpenAI-compatible server that can compact text.
2. Configure `reasoningZip.compactor.baseUrl` and `reasoningZip.compactor.model`.
3. Enable `mode: "llama-only"` and use a llama.cpp provider in Pi.
4. Ask a prompt that produces long visible reasoning/thinking.
5. Inspect the session JSONL.
6. Confirm the new assistant message contains compact `thinking`, not raw verbose reasoning.
7. Confirm older session entries were not changed.
8. Send another prompt and confirm Pi replays the compact trace because that is what was stored.



## Development


### How it works

`pi-reasoning-zip` works through Pi lifecycle hooks:

| Hook | Purpose |
|---|---|
| `message_end` | Compact eligible new assistant `thinking` blocks before storage |
| `before_provider_request` | Optionally inject terse-reasoning guidance for target local providers |


### Self inspecting

The npm library entrypoint still builds to `dist/index.js`, but Pi package metadata points at `./extensions` so Pi can inspect the source it loads.

### Useful commands

```bash
npm run typecheck
npm test
npm run build
npm run check
npm run smoke
pi -e ./extensions --no-extensions --offline --list-models
npm pack --dry-run
```

For local development you can also load the readable source extension directly:

```bash
pi -e ./extensions
```

### Release checklist

1. Update the version in `package.json` and `package-lock.json`.

   ```bash
   npm version <patch|minor|major> --no-git-tag-version
   ```

2. Move completed `CHANGELOG.md` entries from `[Unreleased]` to the new version section.

   ```md
   ## [Unreleased]

   ## [x.y.z] - YYYY-MM-DD
   ```

3. Update changelog links at the bottom.

   ```md
   [Unreleased]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/vx.y.z...HEAD
   [x.y.z]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/vprevious...vx.y.z
   ```

   For the first release, link the version to the release page:

   ```md
   [0.1.0]: https://github.com/Ryu-CZ/pi-reasoning-zip/releases/tag/v0.1.0
   ```

4. Verify build, source-extension load, smoke test, package contents, and npm publish metadata.

   ```bash
   npm run check
   npm run smoke
   pi -e ./extensions --no-extensions --offline --list-models
   npm pack --dry-run
   npm publish --dry-run
   ```

5. Commit and tag the release.

   ```bash
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "chore: release vx.y.z"
   git tag -a vx.y.z -m "vx.y.z"
   ```

6. Push branch and tag.

   ```bash
   git push origin main
   git push origin vx.y.z
   ```

7. Publish to npm when ready.

   ```bash
   npm publish
   ```
