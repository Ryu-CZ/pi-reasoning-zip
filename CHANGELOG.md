# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Changed the bare `/reasoning-zip` command from a status display into a shortcut that toggles the extension on or off. Explicit `/reasoning-zip status` remains available.

## [0.6.1] - 2026-08-06

### Changed

- Made the npm package self-inspectable without shipping development evidence: included the operational configuration and llama.cpp slot-pinning guides, kept benchmark artifacts and contributor tooling repository-only, removed the smoke harness from the tarball, clarified repository-only links, expanded local-model discovery keywords, and aligned the Pi peer dependency with Pi package guidance.
- Documented every public setting beside its shipped TypeScript type, including its purpose, effect, accepted policy, and built-in default, so Pi and users can understand configuration directly from the installed source.

## [0.6.0] - 2026-08-06

### Added

- Added compaction of eligible thinking in assistant messages that contain tool calls. Tool-call blocks remain unchanged.
- Added `npm run benchmark` for running the reproducible suite against a local OpenAI-compatible model. Results are written to timestamped local directories and replace the checked-in reference artifacts only with `--promote`.

### Changed

- Replaced `compactor.maxTokens` with `compactor.maxCompactionRatio`, which derives an output budget for each reasoning input. The default ratio is `1`, using a conservative estimate of one token per three source characters. Existing configurations should remove `maxTokens` and set `maxCompactionRatio` only when overriding the default.
- Changed `thresholds.maxTraceChars` from `2000` to `-1`, disabling the fixed output-size guardrail by default. Complete compacted reasoning that passes the other validation checks is no longer rejected solely for exceeding 2,000 characters; set a positive value to restore a fixed maximum.
- Replaced `thresholds.maxInputChars` with automatic source sizing from the compactor model's llama.cpp context metadata. Use `thresholds.fallbackMaxInputChars` only for endpoints that do not report this metadata.
- Reworked the compactor prompt to preserve decision-relevant state, failed-attempt rationale, reconsideration conditions, rollback information, uncertainties, and next actions while omitting instructions quoted inside source reasoning.
- Expanded the configuration reference and reorganized the README as a quick start with detailed configuration, benchmark, and llama.cpp slot-pinning documentation under `docs/`.
- Replaced the previous benchmark claims with reproducible exact-source retention and continuation checks using production defaults; retained the live high-reasoning results as a separately labeled, host-specific stress check.

### Removed

- Removed `storageMode` and `mode: "disabled"`. Use `enabled` as the single control for turning the extension on or off.
- Removed `compressionRole`; compaction now uses the built-in prompt described above.
- Removed `injectPrompt`; the extension no longer changes the main model's system prompt or messages.

### Fixed

- Isolated tests and the compiled smoke harness from the user's real global Pi settings so checks run deterministically on any machine.
- Made llama.cpp auto-mode slot probes less fragile: two-second timeout with successful topology results cached for five seconds.
- Left provider requests untouched when their payload model differs from Pi's current context model, avoiding unsafe provider attribution.
- Cleared request-bound slot state when Pi aborts a provider request, and replaced stale state when a later request has a different request signal.
- Normalized all trailing slashes from the configured compactor base URL.

## [0.5.0] - 2026-07-31

### Added

- Added optional llama.cpp slot pinning to keep reasoning-zip compaction from invalidating the main chat prompt/KV cache on shared local servers:
  - `llamaCppSlots.enabled`: set to `"auto"` to pin only when the main model and compactor share a llama.cpp server with at least two non-colliding configured slots, `true` to force pinning for llama.cpp-targeted requests without probing `GET /slots`, or `false` to disable slot pinning.
  - `llamaCppSlots.mainIdSlot`: llama.cpp `id_slot` used for normal Pi chat requests when pinning is active.
  - `llamaCppSlots.compactorIdSlot`: llama.cpp `id_slot` used for reasoning-zip compactor requests when pinning is active.
  - Auto mode probes the actual `/slots` count for each main request and reuses that request's decision at `message_end`.
  - Probe failure, fewer than two slots, or IDs that collide after llama.cpp's modulo wrapping skip compaction and preserve the original reasoning.
  - Existing explicit main `id_slot` values are preserved and checked for conflicts with the compactor slot.

## [0.4.0] - 2026-07-14

### Added

- Added CI for typecheck, tests, build, smoke test, and package dry-run.
- Added `thresholds.maxInputChars` to skip oversized compactor inputs.
- Added Pi warning notifications when compaction fails and the original reasoning is preserved.

### Changed

- Default targeting mode is now `local-only`.
- Runtime project settings now recursively merge into global `reasoningZip` settings instead of replacing nested objects wholesale.
- Independent thinking blocks in a message are compacted concurrently while preserving block order.
- Tightened the Pi peer dependency from `*` to `^0.80.3`.

### Fixed

- `local-only` now rejects remote `llama-server=` endpoints and llama-like non-local provider ids.
- Compactor requests disable compactor-side thinking with both `chat_template_kwargs.enable_thinking=false` and `thinking_budget_tokens=0`.
- Compactor responses now reject missing content, empty content, inline reasoning wrappers, and truncated completions.
- Prompt-injection marker suppression now ignores spoofed markers in user messages.
- Assistant messages containing tool calls are preserved until tool-call continuation behavior is verified.

## [0.3.0] - 2026-07-10

### Added

- Added `/reasoning-zip` Pi command to inspect, enable, disable, or toggle `reasoningZip.enabled` in project or global settings.
- Added configurable footer status while `reasoningZip.enabled` is active; global `reasoningZip.footerStatus` defaults to `🗜️ Zip`.

## [0.2.9] - 2026-07-10

### Fixed

- Separate mermaid diagrams from README and use SVG images for NPM package page render compatibility.

## [0.2.8] - 2026-07-09

### Changed

- Added a required `rollback` section to compaction prompts so reversible actions remain in compact traces.

## [0.2.7] - 2026-07-09

### Fixed

- Compact llama.cpp reasoning stored by Pi as `thinkingSignature: "reasoning_content"`; this marker identifies the replay field and is not an opaque provider signature.

## [0.2.6] - 2026-07-03

### Changed

- Replaced `thresholds.targetRatio` with `compressionRole` presets for compactor prompt style.

## [0.2.5] - 2026-07-03

### Fixed

- Skip Pi `thinkingSignature` and redacted thinking blocks instead of rewriting opaque provider metadata.
- Enforce `thresholds.targetRatio` when accepting compacted thinking output.

## [0.2.4] - 2026-07-03

### Fixed

- Prompt injection now targets real Pi `before_provider_request` events using `ctx.model.provider`.

## [0.2.3] - 2026-07-03

### Added

- Added strict-endpoint fallback retry for compactor requests that reject `chat_template_kwargs`.

## [0.2.2] - 2026-07-03

### Changed

- Replaced broad extension hook `any` casts with narrow local structural hook types.

### Added

- Added real compactor timeout abort test.

### Fixed

- Disabled compactor-side Qwen/llama.cpp thinking via `chat_template_kwargs.enable_thinking=false` so compact traces are returned in `message.content`.

## [0.2.1] - 2026-07-02

### Changed

- Pi package metadata now loads readable source from `./extensions` and ships `src` for transparency.

## [0.2.0] - 2026-07-02

### Added

- Added developer release checklist to README.

### Changed

- Updated package description to "Compact reasoning blocks to keep the context short."

## [0.1.0] - 2026-07-02

### Added

- Scaffolded Pi extension package for `pi-reasoning-zip`.
- Settings resolver for `reasoningZip` defaults and partial config.
- Provider targeting helpers for llama.cpp/local/all modes.
- Pure assistant `thinking` block compaction transform.
- OpenAI-compatible local compactor client and compaction prompt builder.
- Conservative grug-style prompt injection for target provider requests.
- Vitest coverage for settings, targeting, prompt injection, prompt building, and message transformation.
- MIT license metadata and license file.
- Compiled-extension smoke harness for hook registration, compaction, and prompt injection.
- GitHub/package banner image metadata.

### Changed

- Trimmed npm package contents to runtime build, smoke harness, README, changelog, and license only.
- Reworked README structure to match the concise Pi package style used by sibling packages.
- Added package motto to README.
- Added npm release metadata: description, keywords, repository links, exports, and Node engine.

[Unreleased]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.2.9...v0.3.0
[0.2.9]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Ryu-CZ/pi-reasoning-zip/releases/tag/v0.1.0
