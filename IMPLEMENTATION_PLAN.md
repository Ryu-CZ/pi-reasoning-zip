# pi-reasoning-zip — Implementation Plan

This plan turns `DESIGN.md` into a minimal Pi extension. Keep MVP small: compact only new assistant `thinking` blocks at `message_end`; do not rewrite prior sessions; do not use `context` hook.

## Minimal Product Stage

MVP behavior:

1. Load as a Pi extension.
2. Read `reasoningZip` settings with safe defaults.
3. On each new assistant `message_end`:
   - skip if disabled or non-target provider
   - find `thinking` blocks longer than `minChars`
   - send each eligible block to configured local OpenAI-compatible compactor
   - replace only that block's `thinking` string with compact trace
   - preserve all other message content and metadata
   - return original message unchanged on any failure
4. Optionally inject concise-reasoning prompt into local llama.cpp requests via `before_provider_request`.
5. Ship tests for message transformation, failure behavior, provider targeting, and prompt injection.

Out of MVP:

- no historical session rewrite
- no current-session backfill
- no `context` replay mutation
- no UI beyond optional debug logging
- no hard dependency on `pi-llama-cpp`

## Exact File Layout

```text
pi-reasoning-zip/
├── DESIGN.md
├── IMPLEMENTATION_PLAN.md
├── README.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts                 # Pi extension entrypoint
│   ├── settings.ts              # reasoningZip config resolver/defaults
│   ├── types.ts                 # local config/types and small Pi message types if needed
│   ├── target.ts                # provider/model targeting helpers
│   ├── promptInjection.ts       # before_provider_request payload patching
│   ├── compactorClient.ts       # OpenAI-compatible local compactor HTTP client
│   ├── compactPrompt.ts         # compactor prompt builder
│   ├── messageTransform.ts      # pure assistant-message thinking compaction logic
│   └── hash.ts                  # optional stable hash/cache key helper
└── tests/
    ├── settings.test.ts
    ├── target.test.ts
    ├── promptInjection.test.ts
    ├── messageTransform.test.ts
    └── compactorClient.test.ts
```

Keep most logic pure and testable. `src/index.ts` should wire hooks only.

## Package / Build Setup

`package.json` essentials:

```json
{
  "name": "pi-reasoning-zip",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist", "README.md", "DESIGN.md", "IMPLEMENTATION_PLAN.md"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "check": "npm run typecheck && npm test && npm run build"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typescript": "^5.0.0",
    "vitest": "^3.0.0"
  },
  "pi": {
    "extensions": ["dist/index.js"]
  }
}
```

If Pi package metadata differs, check current Pi docs/examples before finalizing `pi.extensions` shape.

`tsconfig.json` essentials:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

## Implementation Steps

### 1. Scaffold project

Create `README.md`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, and empty test files.

Acceptance:

- `npm install` works.
- `npm run typecheck` works with empty extension.
- `npm test` runs.

### 2. Settings resolver

File: `src/settings.ts`

Implement defaults:

```ts
enabled = true
mode = "llama-only"
storageMode = "compact-new"
injectPrompt = true
compactor.baseUrl = "http://127.0.0.1:7484/v1"
compactor.model = "unsloth"
compactor.apiKey = "sk-placeholder"
compactor.maxTokens = 512
compactor.temperature = 0.1
compactor.timeoutMs = 30000
thresholds.minChars = 1000
thresholds.targetRatio = 0.15
thresholds.maxTraceChars = 2000
```

Resolver should accept partial user config and validate enum values. Invalid config should fall back to safe defaults or disable risky feature with a warning.

Acceptance tests:

- defaults returned for empty config
- partial config merges correctly
- invalid mode/storageMode handled safely

### 3. Target policy

File: `src/target.ts`

Implement helpers:

- `isLlamaProvider(providerId: string): boolean`
  - true for `llama-server=...`
  - maybe true for provider names containing `llama.cpp` if available
- `shouldHandleMessage(message, settings): boolean`
  - disabled => false
  - storageMode !== `compact-new` => false
  - llama-only => assistant provider starts with `llama-server=`
  - local-only => provider/base URL matches configured local endpoints (keep simple in MVP)
  - all => true, subject to safety checks

Acceptance tests:

- llama provider accepted in llama-only
- OpenAI provider skipped in llama-only
- disabled skips all

### 4. Message transform

File: `src/messageTransform.ts`

Pure function shape:

```ts
async function compactAssistantMessage(message, settings, compactText): Promise<{ message, changed: boolean }>
```

Rules:

- Return original object if not assistant.
- Return original if no thinking blocks.
- For each thinking block:
  - skip if `thinking.length < minChars`
  - call `compactText(thinking)`
  - accept compacted output only if non-empty, not `none`, and shorter than original
  - cap to `maxTraceChars` only if clearly safe; otherwise prefer original
- Preserve content order and all non-thinking blocks.
- Preserve all assistant metadata.
- On any block failure, keep that block original; do not fail whole message unless code simplicity requires returning full original.

Acceptance tests:

- compacts long thinking
- skips short thinking
- no thinking unchanged
- text blocks preserved
- tool calls preserved
- multiple thinking blocks keep order
- compactor failure returns original block/message
- compact output longer than original is rejected

### 5. Compactor prompt

File: `src/compactPrompt.ts`

Implement `buildCompactionPrompt(thinking: string): string` using the prompt from `DESIGN.md`.

Acceptance:

- includes exact reasoning text
- includes output format and preservation rules

### 6. Compactor client

File: `src/compactorClient.ts`

Use direct HTTP `fetch` to configured OpenAI-compatible endpoint:

```text
POST {baseUrl}/chat/completions
```

Payload:

```json
{
  "model": "...",
  "messages": [
    { "role": "system", "content": "You compress reasoning traces. Output only compact trace." },
    { "role": "user", "content": "...prompt..." }
  ],
  "max_tokens": 512,
  "temperature": 0.1
}
```

Rules:

- Do not call through Pi's model loop.
- Use timeout via `AbortController`.
- Strip surrounding whitespace.
- Throw on HTTP error, malformed JSON, missing content.
- Caller handles failure by preserving original.

Acceptance tests:

- sends expected payload
- extracts message content
- timeout/error throws

### 7. Prompt injection

File: `src/promptInjection.ts`

Implement conservative payload patch for OpenAI-compatible chat payloads.

Rules:

- only if `injectPrompt` true
- only target providers per settings
- detect `messages` array
- find first `system` or `developer` message
- append marker block once:

```text
<!-- pi-reasoning-zip -->
If reasoning is visible, keep it terse and keyword-heavy. Keep facts, decisions, constraints, failed paths, next action. No prose reasoning. Final answer concise.
```

- if no system/developer message exists, prepend system message only for local llama.cpp target
- do not duplicate marker
- return original payload if shape unknown

Acceptance tests:

- injects into system message
- injects into developer message
- does not duplicate
- skips non-target provider
- unknown payload unchanged

### 8. Extension entrypoint

File: `src/index.ts`

Wire hooks:

```ts
export default function (pi: ExtensionAPI) {
  pi.on("message_end", async (event, ctx) => { ... });
  pi.on("before_provider_request", async (event, ctx) => { ... });
}
```

Implementation notes:

- Read settings from Pi settings API if available; otherwise adapt to actual extension API after checking docs/examples.
- For `message_end`, use `event.message.provider` to target provider.
- Return `{ message: compactedMessage }` only when changed.
- Never access `ctx.sessionManager.getEntries()` for compaction in MVP.

Acceptance:

- typechecks against Pi extension types
- unit tests cover pure logic

## First Commits

Suggested small commits:

1. `docs: add design and implementation plan`
   - `DESIGN.md`
   - `IMPLEMENTATION_PLAN.md`

2. `chore: scaffold pi extension package`
   - package/build/test config
   - empty extension entrypoint
   - README stub

3. `feat: add settings and target policy`
   - `settings.ts`
   - `target.ts`
   - tests

4. `feat: add reasoning compactor client`
   - `compactPrompt.ts`
   - `compactorClient.ts`
   - tests

5. `feat: compact new assistant thinking blocks`
   - `messageTransform.ts`
   - `index.ts` message_end hook
   - tests

6. `feat: add llama prompt injection`
   - `promptInjection.ts`
   - `index.ts` before_provider_request hook
   - tests

7. `docs: document configuration and safety limits`
   - README usage/config examples

## Test Plan

Run on every change:

```bash
npm run typecheck
npm test
npm run build
```

Final gate:

```bash
npm run check
```

Manual smoke test after MVP:

1. Install extension locally into Pi or run via Pi extension path.
2. Configure `reasoningZip.compactor.baseUrl` to local llama.cpp `/v1` endpoint.
3. Use a llama.cpp model that emits reasoning/thinking.
4. Send a prompt that generates long reasoning.
5. Inspect session JSONL.
6. Confirm the new assistant message has compact `thinking` text.
7. Confirm earlier session entries did not change.
8. Send another prompt and confirm compact trace is what Pi replays.

## Hard Stop Conditions

Stop and ask/design before implementing if:

- Pi `message_end` replacement occurs after storage instead of before storage.
- Pi assistant message type cannot safely preserve thinking/tool metadata.
- Provider signed/encrypted thinking cannot be distinguished from plain thinking.
- Settings API shape is unclear after reading Pi extension examples.

Do not work around these by rewriting session files.
