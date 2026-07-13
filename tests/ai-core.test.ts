/**
 * ai-core.test.ts — Invariant tests for the core AI evaluation/search
 * helpers (no full search, no worker). These lock in engine
 * semantics that the E2E suite cannot assert cheaply.
 */
import { test, describe, expect } from "vitest";
import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import { PIECE_TYPE, PIECE_STRENGTH, Piece } from "../js/pieces.ts";
import {
  getMaterialValue,
  getDynamicPieceValue,
  getAllActions,
  evaluateBoard,
  computeZobristHash,
} from "../js/ai-core.ts";

function createStartingGame(): Game {
  const game = new Game();
  game.init(generateBoard());
  return game;
}

describe("ai-core: material valuation", () => {
  test("piece strength ordering (pawn<knight==bishop<rook<queen)", () => {
    const fire = FACTION.FIRE;
    const mk = (t: PieceType) => getMaterialValue(new Piece(t, fire), fire);

    // Knight and Bishop are equally valued in standard piece tables.
    expect(mk(PIECE_TYPE.PAWN)).toBeLessThan(mk(PIECE_TYPE.KNIGHT));
    expect(mk(PIECE_TYPE.KNIGHT)).toBe(mk(PIECE_TYPE.BISHOP));
    expect(mk(PIECE_TYPE.BISHOP)).toBeLessThan(mk(PIECE_TYPE.ROOK));
    expect(mk(PIECE_TYPE.ROOK)).toBeLessThan(mk(PIECE_TYPE.QUEEN));
  });

  test("RPS disadvantage inflates the victim's material value", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE);
    const neutral = getMaterialValue(pawn, FACTION.FIRE); // own perspective => neutral (1.0x)
    // fire > water, so from water's perspective the fire pawn is advantaged => 0.85x.
    const advantaged = getMaterialValue(pawn, FACTION.WATER);
    expect(advantaged).toBeLessThan(neutral);
    expect(neutral).toBeGreaterThan(0);
  });
});

describe("ai-core: dynamic piece value (RPS multiplier)", () => {
  test("RPS advantage reduces value, disadvantage inflates it", () => {
    const vt = PIECE_TYPE.PAWN;
    const neutral = getDynamicPieceValue(vt, FACTION.FIRE, FACTION.FIRE); // equal => 1.0
    const advantage = getDynamicPieceValue(vt, FACTION.FIRE, FACTION.WATER); // fire > water
    const disadvantage = getDynamicPieceValue(vt, FACTION.WATER, FACTION.FIRE); // water < fire
    // advantage => 0.85x, disadvantage => 1.15x (relative to neutral 1.0)
    expect(advantage).toBeLessThan(neutral);
    expect(disadvantage).toBeGreaterThan(neutral);
  });
});

describe("ai-core: zobrist hash (transposition invariant)", () => {
  test("identical starting positions produce identical hashes", () => {
    const a = createStartingGame();
    const b = createStartingGame();
    expect(computeZobristHash(a)).toBe(computeZobristHash(b));
  });
});

describe("ai-core: action generation", () => {
  test("the starting position yields legal actions for the side to move", () => {
    const game = createStartingGame();
    const actions = getAllActions(game, game.currentFaction);
    expect(actions.length).toBeGreaterThan(0);
    // Every returned action must reference a live piece of the moving faction.
    for (const a of actions) {
      expect(a.piece.faction).toBe(game.currentFaction);
      expect(a.piece.alive).toBe(true);
    }
  });
});

describe("ai-core: board evaluation (material invariant)", () => {
  test("a side with more material scores higher from its own perspective", () => {
    const base = createStartingGame();
    const baseScore = evaluateBoard(base, FACTION.FIRE);

    // Clone and remove an enemy (water) piece to give fire a material edge.
    const g2 = createStartingGame();
    const enemy = g2.pieces.find(
      (p) => p.faction === FACTION.WATER && p.alive,
    )!;
    enemy.alive = false;
    const boostedScore = evaluateBoard(g2, FACTION.FIRE);

    expect(boostedScore).toBeGreaterThan(baseScore);
  });
});
