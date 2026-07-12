// @ts-nocheck
/**
 * replay-format.test.js — focused unit tests for the pure formatting/parsing
 * helpers in js/replay.ts that previously had uncovered branches:
 *   - formatMove: promotion-only, combat+rps, capture, check, checkmate, elimination
 *   - getResultString: ongoing / draw / per-faction win
 *   - escapePGN: quotes, backslashes, newlines
 *   - wrapLine: fits / normal wrap / single word longer than maxLength
 *   - parseMoveToken: promotion variants + fallback
 */
import { expect, test, describe } from "vitest";
import {
  formatMove,
  getResultString,
  escapePGN,
  wrapLine,
  parseMoveToken,
} from "../js/replay.ts";

describe("formatMove", () => {
  const piece = { faction: "fire", type: "queen" };

  test("promotion-only entry (no target) renders Promotion=Q", () => {
    const out = formatMove(
      { action: "promotion", piece: { faction: "fire", type: "pawn" } },
      {},
      0,
    );
    expect(out).toBe("fire_Promotion=Q");
  });

  test("entry without target falls back to Promotion=Q", () => {
    const out = formatMove(
      { piece: { faction: "water", type: "rook" } },
      {},
      0,
    );
    expect(out).toBe("water_Promotion=Q");
  });

  test("combat with advantage/disadvantage/neutral RPS symbol", () => {
    expect(
      formatMove(
        { action: "combat", rpsResult: "advantage", piece, to: { q: 1, r: 2 } },
        {},
        0,
      ),
    ).toContain(" >");
    expect(
      formatMove(
        {
          action: "combat",
          rpsResult: "disadvantage",
          piece,
          to: { q: 1, r: 2 },
        },
        {},
        0,
      ),
    ).toContain(" <");
    expect(
      formatMove(
        { action: "combat", rpsResult: "neutral", piece, to: { q: 1, r: 2 } },
        {},
        0,
      ),
    ).toContain(" =");
  });

  test("combat marks capture with _x_ in the coordinate", () => {
    const out = formatMove(
      { action: "combat", rpsResult: "advantage", piece, to: { q: 1, r: 2 } },
      {},
      0,
    );
    expect(out).toContain("fire_Queen_x_1,2");
  });

  test("promotion flag appends =Q", () => {
    const out = formatMove(
      { action: "move", promotion: true, piece, to: { q: 3, r: 4 } },
      {},
      0,
    );
    expect(out).toBe("fire_Queen_3,4=Q");
  });

  test("checkmate appends #, plain check appends +", () => {
    expect(
      formatMove(
        { action: "move", checkmate: true, piece, to: { q: 0, r: 0 } },
        {},
        0,
      ),
    ).toBe("fire_Queen_0,0#");
    expect(
      formatMove(
        { action: "move", inCheck: true, piece, to: { q: 0, r: 0 } },
        {},
        0,
      ),
    ).toBe("fire_Queen_0,0+");
  });

  test("elimination appends [<faction> eliminated]", () => {
    const out = formatMove(
      { action: "move", elimination: "water", piece, to: { q: 0, r: 0 } },
      {},
      0,
    );
    expect(out).toContain("[water eliminated]");
  });
});

describe("getResultString", () => {
  test("ongoing game yields *", () => {
    expect(getResultString({ state: "select_piece", moveHistory: [] })).toBe(
      "*",
    );
  });

  test("game over without winner yields draw marker", () => {
    expect(getResultString({ state: "game_over", moveHistory: [] })).toBe(
      "1/2-1/2-1/2",
    );
  });

  test("game over maps each winning faction to its result", () => {
    expect(
      getResultString({
        state: "game_over",
        moveHistory: [{ winner_faction: "fire" }],
      }),
    ).toBe("1-0-0");
    expect(
      getResultString({
        state: "game_over",
        moveHistory: [{ winner_faction: "water" }],
      }),
    ).toBe("0-1-0");
    expect(
      getResultString({
        state: "game_over",
        moveHistory: [{ winner_faction: "nature" }],
      }),
    ).toBe("0-0-1");
  });
});

describe("escapePGN", () => {
  test("escapes quotes, backslashes and newlines", () => {
    expect(escapePGN('a"b')).toBe('a\\"b');
    expect(escapePGN("a\\b")).toBe("a\\\\b");
    expect(escapePGN("a\nb")).toBe("a b");
  });
});

describe("wrapLine", () => {
  test("returns single line when it already fits", () => {
    expect(wrapLine("short text", 100)).toEqual(["short text"]);
  });

  test("wraps on word boundaries", () => {
    const out = wrapLine("one two three four", 10);
    expect(out.length).toBeGreaterThan(1);
    for (const l of out) expect(l.length).toBeLessThanOrEqual(10);
  });

  test("a single word longer than maxLength stays on its own line", () => {
    const out = wrapLine("supercalifragilisticexpialidocious", 5);
    expect(out).toEqual(["supercalifragilisticexpialidocious"]);
  });
});

describe("parseMoveToken", () => {
  test("parses a normal move with capture and RPS advantage", () => {
    const m = parseMoveToken("fire_Queen_x_1,2 >");
    expect(m.faction).toBe("fire");
    expect(m.pieceName).toBe("queen");
    expect(m.target).toEqual({ q: 1, r: 2 });
    expect(m.rpsResult).toBe("advantage");
    expect(m.isCapture).toBe(true);
  });

  test("parses promotion with piece name", () => {
    const m = parseMoveToken("fire_Pawn_Promotion=Q");
    expect(m.promotion).toBe(true);
    expect(m.pieceName).toBe("pawn");
    expect(m.target).toBeNull();
  });

  test("parses simple promotion without piece name", () => {
    const m = parseMoveToken("water_Promotion=Q");
    expect(m.promotion).toBe(true);
    expect(m.faction).toBe("water");
    expect(m.pieceName).toBe("promotion");
  });

  test("falls back to raw token on unparseable input", () => {
    const m = parseMoveToken("??? not a move ???");
    expect(m.san).toBe("??? not a move ???");
    expect(m.raw).toBe("??? not a move ???");
  });

  test("strips trailing [comments] from the token", () => {
    const m = parseMoveToken("fire_Queen_1,2 [water eliminated]");
    expect(m.target).toEqual({ q: 1, r: 2 });
    expect(m.faction).toBe("fire");
    expect(m.pieceName).toBe("queen");
  });
});
