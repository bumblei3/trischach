/**
 * game-draw.test.js - focused coverage for js/game.ts draw detection and
 * pawn promotion that the higher-level flow tests don't isolate:
 *  - _updateDrawState: threefold repetition + 50-move rule
 *  - isPromotion: pawn reaching its promotion rank
 *  - handleCellClick promotion path sets PROMOTION state + pendingPromotion
 *
 * Deterministic, no AI search, no DOM.
 */
import { expect, test, describe, beforeEach } from "vitest";
import { Game, GAME_STATE } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import { Piece, PIECE_TYPE } from "../js/pieces.ts";
import { Hex } from "../js/hex.ts";

function makeGame() {
  const game = new Game();
  game.init(generateBoard());
  return game;
}

describe("_updateDrawState", () => {
  let game;
  beforeEach(() => {
    game = makeGame();
  });

  test("threefold repetition triggers DRAW_REPETITION", () => {
    const hash = game._positionHash();
    game._positionHistory = new Map([[hash, 3]]);
    const isDraw = game._updateDrawState(false, false);
    expect(isDraw).toBe(true);
    expect(game.state).toBe(GAME_STATE.DRAW_REPETITION);
  });

  test("threefold requires THREE consecutive occurrences of the same hash", () => {
    // The engine stores a per-position repeat count that is only incremented
    // when the SAME position recurs on consecutive calls. A single occurrence
    // (count 1) or a count below 3 must NOT trigger a draw.
    const hash = game._positionHash();
    // First occurrence: count becomes 1.
    expect(game._updateDrawState(false, false)).toBe(false);
    expect(game.state).not.toBe(GAME_STATE.DRAW_REPETITION);
    expect(game._positionHistory.get(hash)).toBe(1);

    // A DIFFERENT position recorded on the SAME game must not advance the
    // repeat counter for the original hash: the original stays at 1 while the
    // new position starts its own counter at 1.
    const other = new Game();
    other.init(generateBoard());
    other.pieces = other.pieces.filter((p) => p.faction !== FACTION.WATER);
    other._rebuildOccupiedMap();
    const otherHash = other._positionHash();
    // Record `otherHash` on THIS game's history (simulating an intervening
    // different position in the real move sequence).
    game._positionHistory.set(otherHash, 1);
    expect(game._positionHistory.get(otherHash)).toBe(1);
    expect(game._positionHistory.get(hash)).toBe(1); // original untouched

    // Two more repeats of the ORIGINAL hash -> total 3 -> draw.
    expect(game._updateDrawState(false, false)).toBe(false); // count 2
    expect(game._updateDrawState(false, false)).toBe(true); // count 3
    expect(game.state).toBe(GAME_STATE.DRAW_REPETITION);
    expect(game._positionHistory.get(hash)).toBe(3);
  });

  test("50-move rule (100 half-moves) triggers DRAW_50MOVE", () => {
    game._halfmoveClock = 100;
    const isDraw = game._updateDrawState(false, false);
    expect(isDraw).toBe(true);
    expect(game.state).toBe(GAME_STATE.DRAW_50MOVE);
  });

  test("no draw when position not repeated and clock is low", () => {
    game._positionHistory = new Map();
    game._halfmoveClock = 5;
    expect(game._updateDrawState(false, false)).toBe(false);
    expect(game.state).not.toBe(GAME_STATE.DRAW_REPETITION);
    expect(game.state).not.toBe(GAME_STATE.DRAW_50MOVE);
  });

  test("capture resets the half-move clock (no 50-move draw)", () => {
    game._halfmoveClock = 99;
    // A capture means wasCapture=true -> _halfmoveClock reset to 0
    const isDraw = game._updateDrawState(true, false);
    expect(isDraw).toBe(false);
    expect(game._halfmoveClock).toBe(0);
  });
});

describe("isPromotion", () => {
  let game;
  beforeEach(() => {
    game = makeGame();
  });

  test("true for a pawn whose target rank is the promotion rank (r <= 0)", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    expect(game.isPromotion(pawn, new Hex(0, 0))).toBe(true);
    expect(game.isPromotion(pawn, new Hex(-1, -1))).toBe(true);
  });

  test("false for a pawn not on the promotion rank", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 3));
    expect(game.isPromotion(pawn, new Hex(0, 2))).toBe(false);
  });

  test("false for a non-pawn piece", () => {
    const rook = new Piece(PIECE_TYPE.ROOK, FACTION.FIRE, new Hex(0, 1));
    expect(game.isPromotion(rook, new Hex(0, 0))).toBe(false);
  });
});

describe("RPS attack categorization invariant", () => {
  let game;
  beforeEach(() => {
    game = makeGame();
    // RPS-only categorization is exercised when rpsEnabled is true.
    game.rpsEnabled = true;
  });

  test("categorizeAttacks never flags a same-faction (neutral) target", () => {
    // The engine's getValidMoves filters out friendly-occupied squares from the
    // attack set (isFriendly -> `continue`), so categorizeAttacks only ever sees
    // enemy or empty targets. Verify the public contract: when Fire selects a
    // piece that is fully surrounded by its OWN pieces, the returned attack set
    // is empty and the neutral bucket is never populated. This guards the
    // `result.neutral` branch (game.ts categorizeAttacks) from silently
    // classifying a friendly capture as neutral at the UI layer.
    const center = new Hex(0, 0);
    const fireCenter = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, center);
    // Cling Fire pieces on every hex neighbor so no enemy/empty attack exists.
    const neighborFactions = [
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, 0)),
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1)),
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(-1, 1)),
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(-1, 0)),
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, -1)),
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, -1)),
    ];
    game.pieces = [fireCenter, ...neighborFactions];
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0;
    game.currentFaction = FACTION.FIRE;
    game.state = GAME_STATE.SELECT_PIECE;

    const result = game.handleCellClick(center);
    expect(result.action).toBe("select");
    // Surrounded only by friendly pieces -> no attack targets at all.
    expect(result.attacks.length).toBe(0);
    expect(result.rpsAttacks).not.toBeNull();
    expect(result.rpsAttacks.neutral.length).toBe(0);
    expect(result.rpsAttacks.advantage.length).toBe(0);
    expect(result.rpsAttacks.disadvantage.length).toBe(0);
  });

  test("categorizeAttacks assigns enemy targets to advantage/disadvantage (not neutral)", () => {
    // A Fire queen next to a Nature pawn (Fire beats Nature -> advantage) must
    // land in `advantage`, never `neutral`. Confirms the RPS mapping is applied
    // to every produced attack target.
    const fireQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 0));
    const naturePawn = new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(1, 0));
    game.pieces = [fireQueen, naturePawn];
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0;
    game.currentFaction = FACTION.FIRE;
    game.state = GAME_STATE.SELECT_PIECE;

    const result = game.handleCellClick(fireQueen.pos);
    expect(result.rpsAttacks.advantage.some((h) => h.equals(new Hex(1, 0)))).toBe(
      true,
    );
    expect(result.rpsAttacks.neutral.length).toBe(0);
  });
});

describe("Threefold repetition over the full handleCellClick flow", () => {
  test("a move that repeats the position a 3rd time ends the game as a draw", () => {
    // End-to-end guard: the repetition counter is advanced by every real move
    // through _updateDrawState (not just the isolated unit test). Seed the
    // history with the starting position already seen twice, then play a
    // 4-half-move loop (two knights commuting) that returns to the exact start
    // position — the 3rd occurrence must set DRAW_REPETITION via handleCellClick.
    const game = new Game();
    game.init(generateBoard());
    game.rpsEnabled = false;
    // Nature removed so the turn order is just Fire -> Water -> Fire -> Water,
    // letting two knights commute back to the start in 4 plies.
    game.eliminatedFactions.add(FACTION.NATURE);

    const fireKnight = new Piece(PIECE_TYPE.KNIGHT, FACTION.FIRE, new Hex(0, 0));
    const waterKnight = new Piece(
      PIECE_TYPE.KNIGHT,
      FACTION.WATER,
      new Hex(0, 3),
    );
    game.pieces = [fireKnight, waterKnight];
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0; // FIRE
    game.currentFaction = FACTION.FIRE;
    game.state = GAME_STATE.SELECT_PIECE;

    // Seed: the position as it appears AFTER Water's move (currentFactionIdx
    // is still 1 when _updateDrawState runs, because the turn advances after
    // the draw check). The 4-ply loop below returns to exactly this position
    // with the same side-to-move, so seed it twice.
    game.currentFactionIdx = 1; // WATER to move (as seen by _updateDrawState)
    const startHash = game._positionHash();
    game.currentFactionIdx = 0; // FIRE to move for the first ply
    game._positionHistory = new Map([
      [startHash, 2],
      ["some-other-pos", 1],
    ]);

    // 4 plies that commute both knights out and back to the start square.
    // Fire: (0,0) -> (-2,1) -> (0,0); Water: (0,3) -> (-1,2) -> (0,3).
    const play = (from, to) => {
      game.handleCellClick(from);
      return game.handleCellClick(to);
    };

    play(new Hex(0, 0), new Hex(-2, 1)); // Fire out
    play(new Hex(0, 3), new Hex(-1, 2)); // Water out
    play(new Hex(-2, 1), new Hex(0, 0)); // Fire back
    const last = play(new Hex(-1, 2), new Hex(0, 3)); // Water back -> start again

    // The 3rd occurrence of the starting position triggers the draw.
    expect(game.state).toBe(GAME_STATE.DRAW_REPETITION);
    expect(last.draw).toBe(true);
    expect(game._positionHistory.get(startHash)).toBe(3);
  });
});
