# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Test-suite hardening across thirteen iterations (565 → 591 passing unit
  tests, no skips, `tsc --noEmit` clean):
  - **Threefold-repetition invariant** (`tests/game-draw.test.js`): the
    `_updateDrawState` repeat counter is now asserted to require THREE
    _consecutive_ occurrences of the same position hash — an intervening
    different position must not advance the original hash's counter.
  - **RPS attack-categorization invariant** (`tests/game-draw.test.js`):
    `categorizeAttacks` is verified to never classify a same-faction (neutral)
    target. When a piece is fully surrounded by friendly pieces the attack set
    is empty and the `neutral` bucket stays empty; enemy targets land in
    `advantage`/`disadvantage`, never `neutral`.
  - **Undo after faction elimination** (`tests/game-state.test.js`): capturing
    the enemy king eliminates the faction; `undo()` now fully reverts it —
    `eliminatedFactions` is cleared and the eliminated king is revived. Guards
    the historically corruption-prone `eliminatedFactions` + killed-pieces
    restore path.
  - **King-less faction is never checkmate/stalemate** (`tests/game-check.test.js`):
    `isCheckmateInternal`/`isStalemateInternal` are asserted to return `false`
    when the faction has no living king (already eliminated).
  - **nextTurn skips two eliminated factions** (`tests/game.test.js`): with
    Water AND Nature eliminated, a Fire move wraps the turn back onto Fire
    itself (the historically infinite-loop-prone 2-eliminated `_nextTurn` case).
  - **TSPN elimination round-trip** (`tests/replay-logic.test.js`): a real game
    driven to a faction elimination serializes `[nature eliminated]` and
    `parseTSPN` round-trips it as exactly one move carrying `elimination`.
  - **Replay round-trip replays a saved game** (`tests/replay-logic.test.js`):
    a TSPN loaded via `parseTSPN` (which carries only faction/pieceName/target,
    no source square) is now replayed to the final position by
    `reconstructGameFromTSPN` + `ReplayController`. Guards the previously silent
    replay abort (and the `piece.pos`-becomes-a-plain-object crash).
  - **Game over when only one faction remains** (`tests/game.test.js`): capturing
    the last enemy king drives `aliveAfter.length <= 1` to `GAME_OVER` with the
    surviving faction declared `winner_faction` (game.ts:398-403).
  - **Checkmate eliminates the mated faction** (`tests/game.test.js`): a real
    checkmating move (back-rank mate) eliminates the mated faction, mirroring the
    stalemate-elimination rule — verified through the full `handleCellClick` flow.
  - **snapshot()/restore() round-trips without aliasing** (`tests/game-state.test.js`):
    `game.snapshot()` → `game.restore(snap)` reproduces the exact state and is a
    true deep copy (mutating the restored game does not leak back into the
    snapshot). Protects the undo/AI snapshot path.
  - **AI search honors a tight time limit** (`tests/integration.test.js`):
    `calculateBestMove` returns well within a hard ceiling (regression guard for
    the 1.1.1 CI hang) even with an artificially low `MAX_SEARCH_MS`.
  - **Undo reverts a stalemate elimination** (`tests/game-state.test.js`):
    the undo path restores a stalemate-eliminated faction (not only a
    king-capture elimination).
  - **Threefold repetition over the full handleCellClick flow** (`tests/game-draw.test.js`):
    a 4-ply knight-commutation that returns to the same position with the same
    side-to-move triggers `DRAW_REPETITION` end-to-end (not just the isolated
    `_updateDrawState` unit).
  - **Undo reverts a promotion** (`tests/promotion.test.js`): a promoted pawn is
    demoted back to a pawn (and returned to its pre-promo square) by `undo()`.
  - **Pinned piece cannot move** (`tests/check.test.js`): a pinned pawn that
    would expose its own king to check is rejected by `handleCellClick` (the
    pawn stays put, turn does not advance).
  - **King may not move into check / may escape check** (`tests/game-check.test.js`):
    `getLegalMoves` excludes king squares under attack and keeps the legal
    escape square.
  - **handleCellClick is a no-op after the game ends** (`tests/promotion.test.js`):
    clicks in `GAME_OVER` / draw states return `null` and leave state untouched.
  - **RPS disadvantage kills the attacker** (`tests/game.test.js`,
    `tests/promotion.test.js`): through both `handleCellClick` and
    `simulateMove`, a disadvantaged attacker dies and the defender survives
    (symmetric counterpart to the advantage case).
  - **50-move rule over the full handleCellClick flow** (`tests/game-draw.test.js`):
    a quiet move reaching 100 half-moves ends in `DRAW_50MOVE`, while a capture
    resets the clock to 0 and prevents the draw — both verified end-to-end.

### Fixed

- **TSPN parser shredded elimination annotations** (`js/replay.ts`):
  `parseMoveText` split move lines blindly on whitespace, so
  `1. fire_Queen_x_0,1 > [nature eliminated]` was parsed as three bogus tokens
  (`1.`, `[nature`, `eliminated]`) — the elimination marker was lost on load.
  It now splits on move-number boundaries (`\d+\.`), treats the trailing
  `[X eliminated]` annotation as a single unit (even with spaces), and sets the
  new `elimination` field on `ParsedMove`. Legacy single-line multi-move input
  is still supported.
- **TSPN replay path was broken for saved games** (`js/replay.ts`):
  `replayGame`/`precomputeStates` could only replay in-memory move history
  (which carries a live `piece` with `pos`); moves loaded from a TSPN file had
  no `piece`, so the replay skipped every move silently — loaded games could
  not be replayed. Two coupled defects fixed:
  1. Added `resolveSourcePiece(game, move)` which resolves the source square at
     replay time from `faction` + `pieceName` + the target's legal moves when no
     `piece` is present (mock games without `getLegalMoves` fall back to the
     first candidate).
  2. The `target` parsed from a TSPN is a plain `{q,r}` object; it is now
     converted to a real `Hex` before being passed to `handleCellClick`, which
     previously set `piece.pos` to a plain object and crashed the post-move
     check detection (`getValidMoves` → `piece.pos.add is not a function`).
     `Hex` is now imported in `replay.ts`.

### Docs

- Corrected README: actual unit-test count (579 passing, 0 skipped), `ai-worker`
  is now `ai-worker.ts`, CI runs Node 24 (not 20), and the stalemate branch in
  `game.ts` is live (eliminates the stalemated faction) — the earlier
  "dead-code" note no longer applies.

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

## [1.1.0] - 2026-07-10

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

## [1.0.0] - 2026-06-17

### Added

- Initial stable release: TriSchach (3-faction RPS chess variant) with
  Auto-Battle, opening book, puzzles, replay and PWA/offline support.

[Unreleased]: https://github.com/bumblei3/trischach/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/bumblei3/trischach/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/bumblei3/trischach/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/bumblei3/trischach/releases/tag/v1.0.0
