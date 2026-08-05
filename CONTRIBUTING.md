# Contributing

## Development checks

```bash
npm run typecheck
npm test
npm run build
npm run check
npm run smoke
pi -e ./extensions --no-extensions --offline --list-models
npm pack --dry-run
```

`npm run check` runs type checking, tests, and a build. The automated smoke test builds `dist/index.js`, registers Pi hooks against a mock extension API, uses a temporary `.pi/settings.json`, mocks the OpenAI-compatible compactor, and verifies thinking compaction plus llama.cpp main-slot pinning without changing the main-model prompt.

## Manual smoke test

1. Start a local llama.cpp or OpenAI-compatible server that can compact text.
2. Configure `reasoningZip.compactor.baseUrl` and `reasoningZip.compactor.model`.
3. Set `mode` to `llama-only` and use a llama.cpp provider in Pi.
4. Ask for a response that produces long visible reasoning.
5. Inspect the session JSONL.
6. Confirm the new assistant message contains compact thinking instead of raw verbose reasoning.
7. Confirm older session entries are unchanged.
8. Send another prompt and confirm Pi replays the compact trace that was stored.

For slot isolation, also follow the multi-turn procedure in [llama.cpp slot pinning](docs/llama-cpp-slot-pinning.md#verification).

## Source inspection and local loading

The npm library entry point builds to `dist/index.js`. Pi package metadata points to `./extensions`, allowing Pi to inspect the source it loads.

Load the readable source extension directly during development:

```bash
pi -e ./extensions
```

Verify isolated source loading without other extensions:

```bash
pi -e ./extensions --no-extensions --offline --list-models
```

## Release checklist

1. Update `package.json` and `package-lock.json`.

   ```bash
   npm version <patch|minor|major> --no-git-tag-version
   ```

2. Move completed `CHANGELOG.md` entries from `[Unreleased]` to a dated version section.

   ```markdown
   ## [Unreleased]

   ## [x.y.z] - YYYY-MM-DD
   ```

3. Update the comparison links at the bottom of `CHANGELOG.md`.

   ```markdown
   [Unreleased]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/vx.y.z...HEAD
   [x.y.z]: https://github.com/Ryu-CZ/pi-reasoning-zip/compare/vprevious...vx.y.z
   ```

   For the first release, link to the release page:

   ```markdown
   [0.1.0]: https://github.com/Ryu-CZ/pi-reasoning-zip/releases/tag/v0.1.0
   ```

4. Verify the build, source-extension load, smoke test, package contents, and npm metadata.

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

6. Push the branch and tag.

   ```bash
   git push origin main
   git push origin vx.y.z
   ```

7. Publish to npm when ready.

   ```bash
   npm publish
   ```
