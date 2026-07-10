/**
 * puzzle.test.js - Tests for TriSchach Puzzle Mode logic (js/puzzle.ts)
 *
 * Covers the deterministic, UI-independent parts:
 *  - formatSAN (the SAN string that later flows into innerHTML — XSS relevant)
 *  - puzzle state management (loadPuzzle / makePuzzleMove / requestHint / reset / abandon)
 *  - localStorage persistence round-trip (savePuzzles / loadPuzzles)
 */
import { expect, test, describe, beforeEach } from "vitest";
import { Hex } from "../js/hex.ts";
import { FACTION } from "../js/board.ts";
import {
  formatSAN,
  getPuzzleState,
  loadPuzzle,
  makePuzzleMove,
  requestHint,
  resetPuzzle,
  abandonPuzzle,
  savePuzzles,
  loadPuzzles,
  validatePuzzle,
} from "../js/puzzle.ts";

// ─── Mock helpers ────────────────────────────────────────────────────────

function makePiece(id, type, q, r) {
  return {
    id,
    type: type,
    faction: FACTION.FIRE,
    pos: new Hex(q, r),
    symbol: type === "pawn" ? "P" : "Q",
  };
}

function makePuzzle(overrides = {}) {
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

// ─── formatSAN ─────────────────────────────────────────────────────────

describe("formatSAN", () => {
  test("pawn has no piece letter prefix", () => {
    const san = formatSAN(
      makePiece("p", "pawn", 1, 1),
      new Hex(3, 3),
      false,
      false,
      false,
    );
    // "1,13,3" — pawn -> no letter prefix, plain "from,to" (no dash separator)
    expect(san).toBe("1,13,3");
  });

  test("non-pawn uses uppercased first letter of type", () => {
    const san = formatSAN(
      makePiece("q", "queen", 0, 0),
      new Hex(2, 2),
      false,
      false,
      false,
    );
    expect(san).toBe("Q0,02,2");
  });

  test("capture appends 'x'", () => {
    const san = formatSAN(
      makePiece("q", "queen", 0, 0),
      new Hex(2, 2),
      true,
      false,
      false,
    );
    expect(san).toBe("Q0,0x2,2");
  });

  test("check appends '+' and mate appends '#'", () => {
    expect(
      formatSAN(
        makePiece("q", "queen", 0, 0),
        new Hex(2, 2),
        false,
        true,
        false,
      ),
    ).toBe("Q0,02,2+");
    expect(
      formatSAN(
        makePiece("q", "queen", 0, 0),
        new Hex(2, 2),
        false,
        true,
        true,
      ),
    ).toBe("Q0,02,2#");
  });

  test("SAN never embeds the piece id (XSS surface stays in pos/type only)", () => {
    const evil = makePiece("<img src=x onerror=alert(1)>", "queen", 0, 0);
    const san = formatSAN(evil, new Hex(2, 2), false, false, false);
    expect(san).toBe("Q0,02,2");
    expect(san).not.toContain("<img");
  });
});

// ─── Puzzle state management ──────────────────────────────────────────────

describe("Puzzle state management", () => {
  beforeEach(() => {
    abandonPuzzle();
  });

  test("getPuzzleState returns an isolated copy", () => {
    const s1 = getPuzzleState();
    const s2 = getPuzzleState();
    expect(s1).not.toBe(s2); // different object references
    expect(s1.currentPuzzle).toBeNull();
  });

  test("loadPuzzle stores the puzzle and resets progress", () => {
    loadPuzzle(makePuzzle());
    const s = getPuzzleState();
    expect(s.currentPuzzle?.id).toBe("puzzle_test");
    expect(s.currentMoveIndex).toBe(0);
    expect(s.isComplete).toBe(false);
    expect(s.isFailed).toBe(false);
  });

  test("makePuzzleMove marks correct first move and advances index", () => {
    loadPuzzle(makePuzzle());
    const res = makePuzzleMove({}, "p1", new Hex(2, 2));
    expect(res.correct).toBe(true);
    expect(res.gameOver).toBe(false);
    expect(getPuzzleState().currentMoveIndex).toBe(1);
  });

  test("makePuzzleMove returns expectedMove on wrong move and flags failure", () => {
    loadPuzzle(makePuzzle());
    const res = makePuzzleMove({}, "p1", new Hex(9, 9));
    expect(res.correct).toBe(false);
    expect(res.expectedMove?.pieceId).toBe("p1");
    expect(getPuzzleState().isFailed).toBe(true);
  });

  test("makePuzzleMove completes the puzzle on the final correct move", () => {
    loadPuzzle(makePuzzle());
    makePuzzleMove({}, "p1", new Hex(2, 2));
    const res = makePuzzleMove({}, "p2", new Hex(3, 3));
    expect(res.correct).toBe(true);
    expect(res.gameOver).toBe(true);
    expect(getPuzzleState().isComplete).toBe(true);
  });

  test("makePuzzleMove is a no-op when no puzzle is loaded", () => {
    const res = makePuzzleMove({}, "p1", new Hex(2, 2));
    expect(res).toEqual({ correct: false, gameOver: false });
  });

  test("requestHint returns the current expected move and sets hintUsed", () => {
    loadPuzzle(makePuzzle());
    const hint = requestHint();
    expect(hint?.pieceId).toBe("p1");
    expect(getPuzzleState().hintUsed).toBe(true);
  });

  test("requestHint returns null when complete", () => {
    loadPuzzle(makePuzzle());
    makePuzzleMove({}, "p1", new Hex(2, 2));
    makePuzzleMove({}, "p2", new Hex(3, 3));
    expect(requestHint()).toBeNull();
  });

  test("resetPuzzle returns to move 0 without losing the puzzle", () => {
    loadPuzzle(makePuzzle());
    makePuzzleMove({}, "p1", new Hex(2, 2));
    resetPuzzle();
    const s = getPuzzleState();
    expect(s.currentMoveIndex).toBe(0);
    expect(s.isComplete).toBe(false);
    expect(s.isFailed).toBe(false);
    expect(s.currentPuzzle?.id).toBe("puzzle_test");
  });

  test("abandonPuzzle clears all state", () => {
    loadPuzzle(makePuzzle());
    abandonPuzzle();
    expect(getPuzzleState().currentPuzzle).toBeNull();
  });
});

// ─── Persistence (localStorage round-trip) ─────────────────────────────────

describe("Puzzle persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("savePuzzles / loadPuzzles round-trips", () => {
    const puzzles = [makePuzzle({ id: "a" }), makePuzzle({ id: "b" })];
    savePuzzles(puzzles);
    const loaded = loadPuzzles();
    expect(loaded.length).toBe(2);
    expect(loaded[0].id).toBe("a");
    expect(loaded[1].solution[0].san).toBe("Q0,0-2,2+");
  });

  test("loadPuzzles returns [] when nothing stored", () => {
    expect(loadPuzzles()).toEqual([]);
  });

  test("loadPuzzles returns [] on corrupt JSON (no throw)", () => {
    localStorage.setItem("trischach-puzzles", "not valid json");
    expect(loadPuzzles()).toEqual([]);
  });

  test("a stored SAN containing HTML survives round-trip (main.ts must escape it)", () => {
    // Prove the XSS surface: puzzle SAN can carry attacker-controlled markup,
    // so the innerHTML consumer (renderSolutionList) MUST escape it.
    const evilSAN = "<img src=x onerror=alert(1)>";
    const puzzle = makePuzzle({
      solution: [{ ...makePuzzle().solution[0], san: evilSAN }],
    });
    savePuzzles([puzzle]);
    const loaded = loadPuzzles();
    expect(loaded[0].solution[0].san).toBe(evilSAN);
  });
});

// ─── validatePuzzle ────────────────────────────────────────────────────────

describe("validatePuzzle", () => {
  test("returns false for a puzzle whose position cannot be deserialized", async () => {
    const bad = makePuzzle({ fen: "" });
    expect(await validatePuzzle(bad)).toBe(false);
  });

  test("returns false for a puzzle with no solution", async () => {
    const bad = makePuzzle({ fen: "Fp0,0#0", solution: [] });
    // deserializePosition may still fail (no pieces), but we guard the shape
    expect(await validatePuzzle(bad)).toBe(false);
  });
});
