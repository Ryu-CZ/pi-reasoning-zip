# pi-reasoning-zip — Extension Design Handoff

## Goal

Build a Pi Coding Agent extension that compresses verbose reasoning from **new model responses before Pi stores them in the session**.

Local models have limited usable context because RAM/VRAM is finite. Pi can store model reasoning as `thinking` blocks in session JSONL. If these blocks are long, later turns replay too much noisy reasoning, making small local contexts feel even smaller.

`pi-reasoning-zip` turns each new verbose reasoning block into a compact decision trace before storage. Future turns then naturally replay the compact trace, not the raw haystack.

One-line product description:

> Compress new model reasoning into dense traces so small-context local Pi agents stay useful longer.

## Core Rule

This extension is **forward-only**.

It must:

- modify only the assistant message currently being finalized
- do so before that message is stored in the Pi session
- leave all previous sessions untouched
- leave earlier entries in the current session untouched
- avoid replay-time mutation in the MVP

No migrations. No session rewrites. No scanning old entries to compact them.

## Terminology

Use these names consistently:

- User-facing term: **reasoning**
- Pi message block type: **thinking**
- Pi thinking block shape:

```json
{ "type": "thinking", "thinking": "..." }
```

Common provider wire names that Pi may convert into `thinking` blocks:

- llama.cpp: `reasoning_content`
- other OpenAI-compatible servers: `reasoning`, `reasoning_text`
- Anthropic-style APIs: `thinking`

Docs/config should say `reasoning`. Code touching Pi messages should say `thinking`.

## Primary Target

Primary target: local llama.cpp / Qwen-style models used through Pi, especially when `pi-llama-cpp` is installed.

Do **not** hard-require `pi-llama-cpp`.

The extension should work as a normal Pi extension and optionally recognize llama.cpp providers such as:

```text
llama-server=http://127.0.0.1:7484
```

The compactor should use a configured local OpenAI-compatible endpoint directly, for example:

```text
http://127.0.0.1:7484/v1
```

## Non-Goals

Do not build:

- a new coding agent
- a session migration tool
- a historical session compressor
- a default replay/context mutator
- a hard dependency on `pi-llama-cpp`
- a universal hosted-provider hidden-reasoning optimizer

Do not mutate:

- previous sessions
- earlier current-session entries
- OpenAI encrypted reasoning
- Anthropic signed thinking that requires signature replay
- tool-call reasoning signatures or `reasoning_details`
- opaque provider metadata needed for continuation

Do not claim to reduce hidden provider-side reasoning tokens. This extension reduces Pi-visible stored/replayed reasoning.

## MVP Behavior

For each new assistant message:

1. Pi receives final assistant message from model.
2. Extension sees the message in `message_end`.
3. If message has long `thinking` blocks and target policy allows compaction:
   - send each eligible block to the local compactor
   - replace the block text with compact trace
   - preserve all non-thinking content
4. Pi stores the replacement message.
5. Later turns replay the compact trace because that is what was stored.

If anything is uncertain or fails, return the original message unchanged.

## Pi Hooks

### Required: `message_end`

Core hook.

Use it to replace only the just-finalized assistant message.

Rules:

- Only handle `event.message.role === "assistant"`.
- Only inspect `event.message.content` blocks in that message.
- Only modify blocks with `type === "thinking"`.
- Preserve block order.
- Preserve text blocks.
- Preserve tool calls.
- Preserve assistant metadata: provider, model, api, usage, stop reason, timestamps, response IDs, etc.
- On timeout/error/invalid compactor output, return original message unchanged.

### Optional: `before_provider_request`

Use only for targeted local providers.

Purpose: append a short instruction that encourages terse reasoning/output from local models.

Instruction intent:

```text
If reasoning is visible, keep it terse and keyword-heavy.
Keep facts, decisions, constraints, failed paths, next action.
No prose reasoning. Final answer concise.
```

Rules:

- Default target: llama.cpp-like providers only.
- Do not inject globally by default.
- Use a marker to avoid duplicate injection.
- Payload rewrite must be conservative.

### Not MVP: `context`

Do not use `context` hook in the first version.

Reason: MVP should be simple and auditable: stored message equals replayed message.

Replay-time filtering can be a future explicit opt-in feature, but not default.

## Configuration

Suggested Pi settings key:

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

Modes:

```ts
mode: "llama-only" | "local-only" | "all" | "disabled"
storageMode: "compact-new" | "off"
```

Defaults:

```ts
mode = "llama-only"
storageMode = "compact-new"
injectPrompt = true
```

Mode meanings:

- `llama-only`: compact only llama.cpp-like providers.
- `local-only`: compact configured local providers/endpoints.
- `all`: compact any eligible plain Pi `thinking` block, but still skip signed/encrypted/opaque provider data.
- `disabled`: no-op.

Storage meanings:

- `compact-new`: compact new assistant thinking before session storage.
- `off`: do not alter assistant messages.

## Compaction Output

The compactor should produce dense state, not prose.

Format:

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

Keep:

- exact file paths
- symbols and function names
- commands
- errors
- decisions
- constraints
- failed attempts
- next actions

Drop:

- self-talk
- repeated planning
- obvious reasoning
- conversational filler
- long prose explanations

Target: 10–20% of original length. If reasoning has no useful state, output `none`.

## Compactor Prompt Draft

```text
Compress this model reasoning into a compact decision trace for future coding-agent context.

Keep exact paths, commands, symbols, errors, decisions, constraints, failed attempts, and next actions.
Drop self-talk, repeated planning, obvious reasoning, filler, and prose.
Use terse bullets under: facts, decisions, constraints, failed, next.
Target 10-20% of original length.
If no useful content remains, output exactly: none

Reasoning:
{{thinking}}
```

## Edge Cases

Handle these explicitly:

- No `thinking` blocks: return original message.
- Thinking shorter than `minChars`: return original block.
- Multiple thinking blocks: compact each independently and keep original order.
- Mixed text + thinking + tool calls: modify only thinking text.
- Tool calls present: preserve tool call IDs, names, arguments, and any thought/signature metadata.
- Compactor unavailable: return original message.
- Compactor output empty/too long/malformed: return original block or truncate only if clearly safe.
- Provider unknown: skip unless `mode === "all"` and block is plain Pi thinking.
- Hosted provider signed/encrypted reasoning: skip.
- Current session already contains old raw thinking: do nothing to it.

## Responsibilities

### Extension responsibilities

- read settings
- detect target provider/model policy for the current new message
- find eligible `thinking` blocks
- call local compactor
- replace only eligible thinking text
- preserve all other message data
- fail open by returning original message

### Compactor responsibilities

- produce compact decision trace
- preserve technical facts exactly
- avoid adding new claims
- avoid prose

### Pi responsibilities

- receive model response
- emit `message_end`
- store returned assistant message
- replay stored messages in future context

## Suggested Implementation Plan

1. Scaffold TypeScript Pi extension package.
2. Add settings resolver for `reasoningZip`.
3. Add message utilities:
   - `isAssistantMessage`
   - `getThinkingBlocks`
   - `shouldCompactThinking`
   - `replaceThinkingBlocks`
4. Add OpenAI-compatible compactor client.
   - Direct HTTP call to configured `baseUrl`.
   - Do not call through Pi agent loop.
   - Timeout.
   - Failure returns original text.
5. Implement `message_end` hook.
6. Add optional `before_provider_request` prompt injection.
7. Add tests.

## Required Tests

- New assistant thinking block is compacted by `message_end`.
- Short thinking is untouched.
- Message with no thinking is untouched.
- User/tool/custom messages are untouched.
- Text blocks are preserved.
- Tool calls are preserved.
- Multiple thinking blocks keep order.
- Compactor failure returns original message.
- Unknown provider skipped by default.
- Existing session entries are never rewritten.
- Prompt injection only affects target providers and is not duplicated.

## Success Criteria

MVP is complete when:

- New assistant responses with eligible `thinking` blocks are compacted before Pi stores them.
- Existing previous-session and earlier current-session thinking blocks are unchanged.
- Future context naturally contains compact traces because compact traces were stored.
- llama.cpp-targeted prompt injection works without affecting other providers by default.
- Hosted-provider opaque reasoning is left untouched.
- Tests cover the required cases above.

## Demo Scenario

1. Run Pi with local llama.cpp model that emits reasoning.
2. Enable `pi-reasoning-zip` with `mode="llama-only"`.
3. Ask a task that creates long reasoning.
4. Verify the stored assistant message contains compact `thinking`, not raw verbose reasoning.
5. Verify older session entries were not changed.
6. Send next prompt and confirm context/token estimate is lower than with raw reasoning.

## Naming

Repo/package: `pi-reasoning-zip`

Suggested names:

- config key: `reasoningZip`
- command: `/reasoning-zip`
- status label: `reasoning-zip`

## Prior Art

Caveman/Grug-style tools reduce visible output. They do not reduce stored/replayed thinking. This project is different: it compresses Pi `thinking` blocks from new assistant messages before storage.
