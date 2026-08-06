# llama.cpp slot pinning

## Why isolation is needed

llama.cpp stores each request's evaluated prompt and generated tokens in a slot's KV cache. A later request can reuse the shared conversation prefix instead of evaluating it again.

By default, Pi does not send llama.cpp's `id_slot`. llama.cpp sees `id_slot: -1` and selects a slot. Pi's `before_provider_request` hook cannot inspect that later auto-selection; it can only preserve an explicit `id_slot` already in the outgoing payload.

Compaction is a second, unrelated chat-completions request. If llama.cpp selects the main conversation's slot, the short compactor request can truncate or replace its cached state. The next Pi turn may then pay the full prompt-evaluation cost.

## Recommended shared-server setup

`--parallel N` creates `N` slots. Two is the minimum for separate main and compactor traffic.

```bash
llama-server \
  --model /path/to/Qwen3.6-27B.gguf \
  --alias Qwen3.6-27B \
  --parallel 2 \
  --kv-unified \
  --no-cache-idle-slots \
  --slots
```

| Option | Purpose |
|---|---|
| `--parallel 2` | Creates separate slots for Pi (`id_slot: 0`) and the compactor (`id_slot: 1`). Use more only for other concurrent workloads. |
| `--kv-unified` | Lets the long Pi request and short compactor request share total KV capacity dynamically. |
| `--no-cache-idle-slots` | Prevents starting the compactor from saving and clearing Pi's idle slot in unified-KV mode. |
| `--slots` | Keeps `GET /slots` available for auto-mode topology verification. It is currently enabled by default, but the explicit flag documents the dependency. |

Keep the server on a trusted interface such as `127.0.0.1`; `/slots` exposes runtime information. Model path, context size, GPU offload, flash attention, sampling, and speculative decoding depend on the model and hardware and are not prescribed here.

Configure the extension separately:

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

This is recommended for a shared server, but pinning remains opt-in. The built-in value of `llamaCppSlots.enabled` is `false` for compatibility with servers that do not support `id_slot` or `/slots`.

## Unified and fixed-partition KV

Unified KV is useful when the Pi conversation is much longer than the reasoning block because either slot can use available capacity. Keep total headroom for both requests. If the main conversation fills the cache, llama.cpp may still purge idle state to run the compactor.

For strict fixed partitions, replace `--kv-unified` with `--no-kv-unified`. llama.cpp then divides `--ctx-size` evenly among slots: with two slots, each receives half, and Pi cannot borrow unused compactor capacity.

## Pinning behavior

When active, the extension adds `id_slot: mainIdSlot` and `cache_prompt: true` to targeted main requests without an explicit slot. It never overwrites an existing `id_slot`. Compactor calls use `id_slot: compactorIdSlot` and `cache_prompt: true`.

Use `id_slot`, not `slot_id`. `cache_prompt: false` is not an ephemeral or no-store mode and can clear the selected slot's reusable state.

| `llamaCppSlots.enabled` | Behavior |
|---|---|
| `false` | Do not pin. This is the built-in default. |
| `"auto"` | Pin only after verifying an eligible shared endpoint and safe topology. |
| `true` | Force pinning without probing; topology safety is user-managed. |

Auto mode treats main and compactor URLs as shared after normalizing a trailing `/v1`. Different endpoints compact normally without shared-server pinning.

## Auto-mode probing

Eligible shared-server main requests use an authenticated `GET /slots` probe with the compactor API key. Concurrent probes are deduplicated, and successful topology results are reused for five seconds. Failed probes are not cached. The probe times out after two seconds.

The decision is bound to that main request and consumed at its `message_end`. This prevents compaction from running under slot assumptions different from those used for the main generation.

Auto mode pins only when:

- main and compactor use the same normalized llama.cpp endpoint;
- `/slots` returns a JSON array with at least two slots; and
- configured or explicit slot IDs do not collide after normalization.

## ID wrapping

llama.cpp wraps an out-of-range ID modulo the slot count. With two slots, IDs `0` and `2` both select slot `0`. Auto mode normalizes `mainIdSlot`, `compactorIdSlot`, and an explicit main `id_slot` before checking collisions.

With `--parallel 1`, every ID selects the only slot. Pinning cannot prevent invalidation; use a separate compactor server or llama.cpp slot save/restore.

## Safeguards and edge cases

Auto mode fails closed for a shared server. It skips the compactor, preserves the original reasoning, and shows a UI warning when:

- the `/slots` probe fails or returns an invalid topology;
- fewer than two slots are available;
- configured IDs collide modulo the slot count;
- an explicit main `id_slot` resolves to the compactor slot;
- slot settings change during generation;
- a matching request-bound decision is missing;
- the main endpoint is unknown; or
- overlapping same-provider requests cannot be correlated safely.

These cases are topology safety failures, not ordinary fail-open compaction failures. Forced `true` mode remains user-managed. If a main request already has an explicit slot, the extension preserves it and warns on a compactor-slot conflict.

## Verification

Confirm at least two distinct slot IDs, normally `0` and `1`:

```bash
curl -sS http://127.0.0.1:8080/slots
```

For a live multi-turn verification:

1. Sample `/slots` while running a main Pi turn, compaction, a first follow-up, and a repeated follow-up.
2. Correlate slot IDs with llama.cpp task logs.
3. Confirm the main request uses the configured main slot and the compactor uses the configured compactor slot.
4. Compare prompt tokens newly evaluated on both follow-ups.

One request pair proves separation but not cache reuse. The repository's measured multi-turn observations are in [Benchmark](https://github.com/Ryu-CZ/pi-reasoning-zip/blob/main/docs/benchmark.md).
