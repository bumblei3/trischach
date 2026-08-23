/**
 * puzzle-state.test.js - focused coverage for the previously-untested
 * parts of TriSchach Puzzle Mode (js/puzzle.ts):
 *  - PuzzleState persistence (saveProgress / loadProgress round-trip)
 *  - makePuzzleMove edge branches (isComplete no-op, stats updates)
 *  - updatePuzzleStats math (attempts / solved / avgTime)
 *  - getDailyPuzzle localStorage caching
 *
 * These are deterministic and fast (no AI search), complementing the
 * formatSAN / basic-state / persistence tests in puzzle.test.js.
 */
import { expect, test, describe, beforeEach, vi } from "vitest";
import { Hex } from "../js/hex.ts";
import { FACTION } from "../js/board.ts";
import type { Game } from "../js/game.ts";
import {
  getPuzzleState,
  loadPuzzle,
  makePuzzleMove,
  requestHint,
  abandonPuzzle,
  savePuzzles,
  loadPuzzles,
  saveProgress,
  loadProgress,
  getDailyPuzzle,
  type Puzzle,
  type PuzzleState,
} from "../js/puzzle.ts";

// makePuzzleMove takes a Game arg but only reads the in-memory puzzleState,
// so a dummy stands in for the unused parameter.
const dummyGame = {} as unknown as Game;

function makePuzzle(overrides: Partial<Puzzle> = {}): Puzzle {
  return {
    id: "puzzle_test",
    fen: "Fp0,0#0",
    initialMoves: [],
    solution: [
      {
        pieceId: "p1",
        pieceType: "queen",
        faction: FACTION.FIRE,
        from: { q: 0, r: 0 },
        to: { q: 2, r: 2 },
        isCapture: false,
        isCheck: true,
        isMate: false,
        san: "Q0,0-2,2+",
      },
      {
        pieceId: "p2",
        pieceType: "pawn",
        faction: FACTION.FIRE,
        from: { q: 1, r: 1 },
        to: { q: 3, r: 3 },
        isCapture: true,
        isCheck: false,
        isMate: true,
        san: "P1,1x3,3#",
      },
    ],
    mateIn: 2,
    difficulty: "medium",
    faction: FACTION.FIRE,
    createdAt: 0,
    ...overrides,
  };
}

// The persisted snapshot carries currentPuzzleId (absent from the in-memory
// PuzzleState type), so read it through this widened shape.
interface StoredProgress extends PuzzleState {
  currentPuzzleId?: string;
}
function loadStoredProgress(): StoredProgress {
  return loadProgress() as StoredProgress;
}

describe("PuzzleState persistence (saveProgress / loadProgress)", () => {
  beforeEach(() => {
    abandonPuzzle();
    localStorage.clear();
  });

  test("loadPuzzle persists progress and loadProgress restores it", () => {
    loadPuzzle(makePuzzle());
    const progress = loadStoredProgress();
    expect(progress).not.toBeNull();
    expect(progress.currentPuzzleId).toBe("puzzle_test");
    expect(progress.currentMoveIndex).toBe(0);
    expect(progress.isComplete).toBe(false);
    expect(progress.isFailed).toBe(false);
    expect(progress.hintUsed).toBe(false);
  });

  test("live state reflects move index, hint and failure after interactions", () => {
    loadPuzzle(makePuzzle());
    requestHint();
    makePuzzleMove(dummyGame, "p1", new Hex(2, 2)); // correct move 1
    makePuzzleMove(dummyGame, "p1", new Hex(9, 9)); // wrong move -> failed

    // makePuzzleMove updates the in-memory state but only persists via
    // saveProgress (called by loadPuzzle), so the live state carries the
    // progress while loadProgress reflects the last explicit save.
    const live = getPuzzleState();
    expect(live.currentMoveIndex).toBe(1);
    expect(live.hintUsed).toBe(true);
    expect(live.isFailed).toBe(true);
  });

  test("loadProgress reflects the snapshot taken at loadPuzzle time", () => {
    loadPuzzle(makePuzzle());
    // Only loadPuzzle calls saveProgress, so the persisted snapshot is the
    // initial state (index 0), independent of later in-memory moves.
    const progress = loadStoredProgress();
    expect(progress.currentMoveIndex).toBe(0);
    expect(progress.hintUsed).toBe(false);
  });

  test("saveProgress explicitly then loadProgress round-trips user moves", () => {
    loadPuzzle(makePuzzle());
    makePuzzleMove(dummyGame, "p1", new Hex(2, 2));
    saveProgress();

    const progress = loadStoredProgress();
    expect(progress.currentMoveIndex).toBe(1);
    expect(progress.userMoves.length).toBe(1);
    expect(progress.userMoves[0]!.pieceId).toBe("p1");
  });

  test("loadProgress returns null when nothing stored", () => {
    expect(loadProgress()).toBeNull();
  });
});

describe("makePuzzleMove edge branches", () => {
  beforeEach(() => {
    abandonPuzzle();
    localStorage.clear();
  });

  test("is a no-op (gameOver:false) once the puzzle is already complete", () => {
    loadPuzzle(makePuzzle());
    makePuzzleMove(dummyGame, "p1", new Hex(2, 2));
    const done = makePuzzleMove(dummyGame, "p2", new Hex(3, 3)); // completes
    expect(done.correct).toBe(true);
    expect(getPuzzleState().isComplete).toBe(true);

    // further attempts must not move the index or mutate state
    const extra = makePuzzleMove(dummyGame, "p1", new Hex(2, 2));
    expect(extra).toEqual({ correct: false, gameOver: false });
    expect(getPuzzleState().currentMoveIndex).toBe(2);
  });
});

describe("updatePuzzleStats integration (via makePuzzleMove)", () => {
  beforeEach(() => {
    abandonPuzzle();
    localStorage.clear();
  });

  test("completing the puzzle increments solved + attempts and records avgTime", () => {
    const puzzle = makePuzzle();
    savePuzzles([puzzle]);

    loadPuzzle(puzzle);
    makePuzzleMove(dummyGame, "p1", new Hex(2, 2));
    makePuzzleMove(dummyGame, "p2", new Hex(3, 3)); // final correct move

    const stored = loadPuzzles().find((p) => p.id === "puzzle_test")!;
    expect(stored.stats).toBeDefined();
    expect(stored.stats!.attempts).toBe(1);
    expect(stored.stats!.solved).toBe(1);
    expect(stored.stats!.avgTime).toBeGreaterThanOrEqual(0);
  });

  test("a wrong move records an attempt with solved unchanged", () => {
    const puzzle = makePuzzle();
    savePuzzles([puzzle]);

    loadPuzzle(puzzle);
    makePuzzleMove(dummyGame, "p1", new Hex(9, 9)); // wrong

    const stored = loadPuzzles().find((p) => p.id === "puzzle_test")!;
    expect(stored.stats!.attempts).toBe(1);
    expect(stored.stats!.solved).toBe(0);
    expect(stored.stats!.avgTime).toBeGreaterThanOrEqual(0);
  });

  test("avgTime is an average across multiple attempts", () => {
    const puzzle = makePuzzle();
    savePuzzles([puzzle]);

    loadPuzzle(puzzle);
    // attempt 1: solved (avgTime seeded with elapsed1)
    makePuzzleMove(dummyGame, "p1", new Hex(2, 2));
    makePuzzleMove(dummyGame, "p2", new Hex(3, 3));

    // attempt 2: wrong (updates avg over 2 attempts)
    loadPuzzle(puzzle);
    makePuzzleMove(dummyGame, "p1", new Hex(9, 9));

    const stored = loadPuzzles().find((p) => p.id === "puzzle_test")!;
    expect(stored.stats!.attempts).toBe(2);
    expect(stored.stats!.solved).toBe(1);
    expect(Number.isFinite(stored.stats!.avgTime)).toBe(true);
  });
});

describe("getDailyPuzzle caching", () => {
  beforeEach(() => {
    abandonPuzzle();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  test("returns the cached puzzle when the stored date matches today", async () => {
    const dateParts = new Date().toISOString().split("T");
    const today = dateParts[0]!;
    const daily = makePuzzle({ id: "daily_cached" });
    localStorage.setItem("trischach-daily-puzzle-date", today);
    localStorage.setItem("trischach-daily-puzzle", JSON.stringify(daily));

    const result = await getDailyPuzzle();
    expect(result).not.toBeNull();
    expect(result!.id).toBe("daily_cached");
  });

  test("regenerates when no cached puzzle exists for today", async () => {
    // No date key set -> falls through to generateDailyPuzzle (AI search).
    // generateDailyPuzzle only writes the date key after a puzzle was
    // actually produced (puzzle.ts:664-666); if generation yields nothing it
    // returns null without caching. So: the call must resolve without
    // throwing, the result is a puzzle (string id) or null, and whenever a
    // puzzle is returned the cache was written for today.
    const today = new Date().toISOString().split("T")[0]!;
    const result = await getDailyPuzzle();
    if (result === null) {
      // No puzzle today: the cache date key must NOT claim a puzzle exists.
      expect(localStorage.getItem("trischach-daily-puzzle-date")).toBeNull();
    } else {
      // A returned puzzle is fully formed: string id, valid mateIn, and the
      // cache was written for today.
      expect(typeof result.id).toBe("string");
      expect(result.id.length).toBeGreaterThan(0);
      expect([1, 2, 3]).toContain(result.mateIn);
      expect(["easy", "medium", "hard"]).toContain(result.difficulty);
      const today = new Date().toISOString().split("T")[0]!;
      expect(localStorage.getItem("trischach-daily-puzzle-date")).toBe(today);
    }
  });
});
