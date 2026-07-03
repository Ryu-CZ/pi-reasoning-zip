# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.2.5...HEAD
[0.2.5]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Ryu-CZ/pi-reasoning-zip/releases/tag/v0.1.0
