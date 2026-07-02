# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
