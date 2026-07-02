<p align="center">
  <img src="https://raw.githubusercontent.com/Ryu-CZ/pi-reasoning-zip/main/media/banner.webp" alt="pi-reasoning-zip banner" />
</p>

# pi-reasoning-zip

Compress new Pi-visible assistant `thinking` blocks into compact reasoning traces before they are stored in the session.

This is a forward-only Pi extension for small-context local models. It does **not** rewrite old sessions and does **not** mutate replayed context at `context` time.

## MVP behavior

- Hooks `message_end` for the just-finalized assistant message.
- Finds plain Pi message blocks shaped like `{ "type": "thinking", "thinking": "..." }`.
- For eligible long blocks, calls a configured local OpenAI-compatible compactor endpoint directly.
- Replaces only eligible `thinking` text with the compact trace.
- Preserves text blocks, tool calls, block order, and assistant metadata.
- Fails open: on target mismatch, timeout, HTTP error, malformed compactor output, or unsafe metadata, the original message/block is returned unchanged.
- Optionally hooks `before_provider_request` for local target providers and injects a marked grug-style instruction to keep visible reasoning terse.

## Install / build

```bash
npm install
npm run check
npm run smoke
```

`npm run check` runs typecheck, tests, and build. `npm run smoke` builds the package and runs `scripts/smoke-extension.mjs` against the compiled extension with a mock compactor.

For Pi package loading, `package.json` declares:

```json
{
  "pi": {
    "extensions": ["dist/index.js"]
  }
}
```

During local development you can also load the built extension path directly from Pi if desired.

## Configuration

Put configuration in project `.pi/settings.json` or global `~/.pi/agent/settings.json`. Project settings take precedence.

```json
{
  "reasoningZip": {
    "enabled": true,
    "mode": "llama-only",
    "storageMode": "compact-new",
    "injectPrompt": true,
    "compactor": {
      "baseUrl": "http://127.0.0.1:7484/v1",
      "model": "unsloth",
      "apiKey": "sk-placeholder",
      "maxTokens": 512,
      "temperature": 0.1,
      "timeoutMs": 30000
    },
    "thresholds": {
      "minChars": 1000,
      "targetRatio": 0.15,
      "maxTraceChars": 2000
    }
  }
}
```

### Modes

- `llama-only` — compact only llama.cpp-like providers such as `llama-server=http://127.0.0.1:7484`.
- `local-only` — compact local URL providers and llama.cpp-like providers.
- `all` — compact any eligible plain Pi `thinking` block, while still skipping signed/encrypted/opaque blocks.
- `disabled` — no-op.

### Storage modes

- `compact-new` — compact new assistant thinking before storage.
- `off` — do not alter assistant messages.

## Compactor endpoint

The compactor must expose an OpenAI-compatible chat completions endpoint:

```text
POST {baseUrl}/chat/completions
```

The extension sends the original thinking to the compactor and expects terse output like:

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

Output `none` means no useful trace remains and the original block is preserved.

## Safety limits

The extension skips:

- non-assistant messages
- messages without array content
- short thinking below `thresholds.minChars`
- signed/encrypted/opaque reasoning metadata (`signature`, `reasoning_signature`, `encrypted_content`, `reasoning_details`)
- unknown providers by default in `llama-only`
- hosted/non-local providers in `local-only`

It never scans or rewrites previous session entries.

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
6. Confirm the new assistant message contains compact `thinking` rather than raw verbose reasoning.
7. Confirm older session entries were not changed.
8. Send another prompt and confirm Pi replays the compact trace because that is what was stored.
