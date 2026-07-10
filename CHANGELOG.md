# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.1] - 2026-07-10

### Fixed

- CI `unit-tests` job hung in GitHub Actions (single-fork vitest pool on a
  shared runner): the AI search only checked its time deadline every 1000
  nodes inside `minimax` and `quiesce` had no deadline guard at all, so a
  tactical explosion could block the fork past the 180s test timeout.
  - `quiesce()` now honors the search deadline.
  - Added a hard `MAX_SEARCH_MS` (4s) ceiling in `minimax`/`quiesce`/
    `iterativeDeepening` (and the pondering path) that guarantees
    `calculateBestMove` returns regardless of runtime speed.
- CI `lint` job failed: the tournament-cleanup edit left the README CI-jobs
  table prettier-noncompliant (`npx prettier --check .` now passes).
- CI `unit-tests` reported 352 passed but exited 1: a `setTimeout` callback in
  `main.ts` dereferenced `#combat-overlay` without a null check and threw
  after the integration tests finished under happy-dom. Now null-guarded.
- Removed the orphaned `tournament` CI job and `tournament.js` script (dead
  after the TypeScript port — they imported `./js/game.js` which no longer
  exists and failed every manual/scheduled run).

[Unreleased]: https://github.com/bumblei3/trischach/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/bumblei3/trischach/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/bumblei3/trischach/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/bumblei3/trischach/releases/tag/v1.0.0

### Added

- E2E regression spec covering auto-battle, puzzle, replay and new-game flows.

### Changed

- Ported TriSchach to TypeScript as the sole build entry point (replacing the
  legacy JS sources).
- Bumped CI/dev dependencies (Vite 5→8, Vitest 1→3, happy-dom 14→20,
  vite-node/coverage-v8→3). Clears all npm audit vulnerabilities.
- Raised Vitest `testTimeout` to 180s — the full AI-vs-AI integration test now
  takes ~105s under Vitest 3 / happy-dom 20.

### Fixed

- Auto-Battle UI freeze caused by a worker/service-worker race condition
  (`ai-worker.ts` now posts a `ready` signal immediately on load; `sw.js`
  bypasses cache for worker modules and dynamically imported scripts).
- Auto-Battle crash in the Web Worker (`deserializeGame` now rebuilds board
  cells and Game methods).
- Opening-book warnings and missing favicon.
- Deployed site cache paths in `sw.js`; re-activated GitHub Pages deploy.
- `tsc` rebase artifact: duplicate `boardCells` prop in `ai.ts`
  `deserializeGame`.

### Refactor

- Ported origin/main Auto-Battle and opening-book fixes into the `.ts` sources.

## [1.0.0] - 2026-06-13

### Added

- Initial stable release: TriSchach (3-faction RPS chess variant) with
  Auto-Battle, opening book, puzzles, replay and PWA/offline support.

[Unreleased]: https://github.com/bumblei3/trischach/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/bumblei3/trischach/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/bumblei3/trischach/releases/tag/v1.0.0
