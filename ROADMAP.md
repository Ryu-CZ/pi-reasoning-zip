# Roadmap

This document tracks the work required to move `pi-reasoning-zip` from a
strong beta to a stable `1.0.0` extension. It is intentionally kept in the
repository for maintainers and forks, but is not part of the npm package.

GitHub Issues and milestones should be the live source of status. This file
defines the durable scope, priorities, and evidence required to call each item
complete. `CHANGELOG.md` should record only work that has shipped.

## Current Baseline

The extension already has:

- forward-only compaction of newly finalized assistant messages
- guards for signed, encrypted, redacted, and provider-opaque reasoning
- bounded input and output sizes, request timeouts, and fail-open preservation
- unit tests for settings, targeting, prompt injection, compaction, and hooks
- a mocked extension smoke test and a clean package build
- CI for typecheck, tests, build, smoke, and package inspection
- an initial local compression benchmark

The remaining work is primarily release integrity, privacy-safe activation,
real Pi integration evidence, measurable output quality, and maintainability.

## Tracking Model

Use a GitHub milestone for each target release and one issue per independently
verifiable outcome. Avoid using this file as a task-status board.

Recommended labels:

- `maturity`
- `priority:p0`, `priority:p1`, `priority:p2`
- `security`
- `testing`
- `release`
- `observability`
- `configuration`
- `benchmark`

Recommended project states:

- Backlog
- Ready
- In progress
- Verification
- Done

An issue moves to Done only when its acceptance criteria are supported by the
listed tests, commands, or runtime artifacts.

## Milestones

### v0.5.0 - Safe Activation

Synchronize releases, require informed configuration, and make unsafe or
invalid configurations fail closed.

### v0.6.0 - Integration Confidence

Prove behavior in real Pi session storage, test supported Pi versions, and make
failures diagnosable.

### v1.0.0 - Proven Maturity

Demonstrate that compression preserves downstream task quality, publish a
support policy, and close every P0 and P1 maturity issue.

## Issue Backlog

### P0 - Synchronize And Automate Releases

**Problem:** Repository tags, GitHub Releases, and npm can expose different
versions, leaving installed users without fixes documented on `main`.

**Acceptance criteria:**

- Git tag, GitHub Release, package version, and npm `latest` agree.
- A tag-driven workflow runs all release gates before publishing.
- CI installs and imports the generated tarball in a clean temporary project.
- The published package contents are checked against the intended allowlist.
- Release failure cannot silently leave a version presented as fully released.

**Evidence:** Successful release workflow, `npm view` output, GitHub Release,
and clean-consumer installation log.

### P0 - Require Consent For Remote Compactors

**Problem:** Reasoning may contain source code, credentials, paths, commands,
or operational details. Sending it to a non-local endpoint without explicit
consent is a privacy risk.

**Acceptance criteria:**

- Loopback compactor URLs work without additional permission.
- Non-loopback URLs are rejected unless an explicit setting such as
  `allowRemoteCompactor: true` is present.
- IPv4, IPv6, hostname, malformed URL, and redirect behavior are tested.
- Documentation states exactly what data is sent to the compactor.
- Diagnostics never print API keys or reasoning content.

**Evidence:** URL-policy tests, integration test, and privacy documentation.

### P1 - Provide Safe First-Run Defaults

**Problem:** A fresh installation can currently change prompts and attempt
compaction before the user has validated the endpoint and model.

**Acceptance criteria:**

- A fresh install performs no compaction or prompt injection until explicitly
  configured or enabled.
- Compaction and prompt injection can be enabled independently.
- `/reasoning-zip status` explains why the extension is inactive and what is
  required to activate it.
- Upgrade behavior is documented for existing users.

**Evidence:** Fresh-home integration test, command test, and migration notes.

### P1 - Add A Real Pi Session Integration Test

**Problem:** Unit and smoke tests mock Pi hooks and do not prove stored-session
or replay behavior.

**Acceptance criteria:**

- CI launches the real supported Pi CLI with a deterministic fake
  OpenAI-compatible compactor.
- The newly finalized eligible thinking block is compacted in session JSONL.
- Previous session entries remain byte-for-byte unchanged.
- The next provider request replays the stored compact trace.
- Tool-call, signed, encrypted, redacted, malformed, timeout, and HTTP failure
  cases preserve required data.
- The test executes from the generated npm tarball, not only repository source.

**Evidence:** CI integration job and inspected session fixtures or assertions.

### P1 - Build A Reproducible Quality Benchmark

**Problem:** Compression ratio alone does not prove that a later coding turn can
continue correctly from the compacted trace.

**Acceptance criteria:**

- A checked-in harness runs sanitized, repeatable continuation tasks.
- Results include stored-context savings, retained facts and exact identifiers,
  continuation success, failure rate, compactor requests, and p50/p95 latency.
- Prompt injection enabled and disabled are evaluated separately.
- Quality evaluation is independent of the model that produced the summary, or
  validated against deterministic task outcomes.
- Minimum quality and reliability thresholds are documented before `1.0.0`.

**Evidence:** Versioned benchmark inputs, command, raw result artifact, and
human-readable summary.

### P1 - Validate Configuration And Explain Failures

**Problem:** Malformed files and invalid values can silently fall back to
defaults, making unexpected activation and difficult diagnosis possible.

**Acceptance criteria:**

- Settings have a documented schema and cross-field validation.
- Malformed or unreadable configuration disables active behavior and produces
  an actionable warning.
- Invalid project overrides do not silently replace valid inherited values with
  enabled defaults.
- Numeric settings enforce integer and range constraints.
- Settings writes are atomic and preserve unrelated Pi settings.
- Failure messages distinguish timeout, HTTP status, invalid response, unsafe
  output, and configuration errors without exposing sensitive content.

**Evidence:** Invalid-config matrix, atomic-write tests, and UI notification
tests.

### P2 - Maintain A Pi Compatibility Matrix

**Problem:** Local duplicate hook interfaces and structural casts reduce the
ability of TypeScript to detect upstream API changes.

**Acceptance criteria:**

- Use exported upstream hook types wherever they are stable and available.
- CI tests the minimum and latest supported Pi versions.
- The README states the supported Pi and Node versions.
- A dependency update that changes required hook behavior fails CI.

**Evidence:** Matrix CI job and compile-time compatibility tests.

### P2 - Add Runtime Observability

**Problem:** A generic warning does not reveal whether compaction is effective
or why a block was skipped.

**Acceptance criteria:**

- Status can report compacted, skipped, and failed block counts.
- Status can report characters saved and request latency for the current
  session.
- Skip and failure reasons are available without logging reasoning content.
- Metrics collection adds negligible overhead and can be disabled.

**Evidence:** Metrics unit tests and a real-session status demonstration.

### P2 - Establish A Maintenance Baseline

**Acceptance criteria:**

- Test coverage is collected in CI with thresholds focused on safety-critical
  modules.
- `SECURITY.md` documents private vulnerability reporting and data-handling
  expectations.
- Dependency updates are automated and gated by the full test matrix.
- Contribution guidance includes the release and integration-test commands.

**Evidence:** Repository policy files and passing CI gates.

## Issue Template

Use this body when creating maturity issues:

```markdown
## Problem

What maturity risk exists and who it affects.

## Scope

Exactly what will change and what remains out of scope.

## Acceptance Criteria

- [ ] Observable behavior
- [ ] Automated test
- [ ] Documentation updated
- [ ] Backward compatibility considered

## Verification

Exact commands, CI jobs, and runtime artifacts that prove completion.
```

## Definition Of Mature

The extension is ready for `1.0.0` when:

- repository and published release state are consistent and reproducible
- a fresh installation is inert until the user knowingly configures it
- reasoning cannot leave the local machine without explicit consent
- real Pi session storage and replay behavior are continuously tested
- benchmarks show preserved continuation quality as well as context reduction
- supported Pi versions and failure behavior are documented and tested
- every P0 and P1 issue above is closed with authoritative evidence
