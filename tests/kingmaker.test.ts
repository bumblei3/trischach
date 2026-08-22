/**
 * Kingmaker: greedy must see mate/stalemate elimination (not only king
 * capture) so 2v1 RPS is visible. Fire mating Nature leaves a lost 1v1
 * against Water (Water beats Fire).
 */
import { describe, test, expect } from "vitest";
import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import { Hex } from "../js/hex.ts";
import {
  applyPostMoveEliminations,
  restorePostMoveEliminations,
  kingmakerTerm,
  greedyBestMove,
  getAllActions,
  rebuildOccupiedMap,
  simulateMove,
  undoMove,
  KINGMAKER_RPS_LOSS,
  KINGMAKER_RPS_WIN,
  GAME_WIN_SCORE,
} from "../js/ai-core.ts";

function fresh(): Game {
  const g = new Game();
  g.init(generateBoard());
  return g;
}

describe("applyPostMoveEliminations", () => {
  test("fire bishop -2,1 mates Nature (same as handleCellClick)", () => {
    const g = fresh();
    const bishop = g.pieces.find((p) => p.id === "fire_bishop_2")!;
    const undo = simulateMove(g, bishop, new Hex(-2, 1));
    rebuildOccupiedMap(g);
    const killed = applyPostMoveEliminations(g);
    expect(killed.map((k) => k.faction)).toContain(FACTION.NATURE);
    expect(g.eliminatedFactions.has(FACTION.NATURE)).toBe(true);
    expect(g.pieces.some((p) => p.faction === FACTION.NATURE && p.alive)).toBe(
      false,
    );

    restorePostMoveEliminations(g, killed);
    undoMove(g, undo);
    rebuildOccupiedMap(g);
    expect(g.eliminatedFactions.size).toBe(0);
    expect(g.pieces.filter((p) => p.alive).length).toBe(45);
  });

  test("does not leak state when nobody is mated", () => {
    const g = fresh();
    const pawn = g.pieces.find(
      (p) => p.faction === FACTION.FIRE && p.type === "pawn" && p.alive,
    )!;
    const { moves } = g.getLegalMoves(pawn);
    expect(moves.length).toBeGreaterThan(0);
    const undo = simulateMove(g, pawn, moves[0]!);
    rebuildOccupiedMap(g);
    const killed = applyPostMoveEliminations(g);
    expect(killed).toEqual([]);
    undoMove(g, undo);
    rebuildOccupiedMap(g);
    expect(g.pieces.filter((p) => p.alive).length).toBe(45);
  });
});

describe("kingmakerTerm", () => {
  test("Fire vs Water 2v1 is RPS disadvantage (keep Nature)", () => {
    const g = fresh();
    g.eliminatedFactions.add(FACTION.NATURE);
    expect(kingmakerTerm(g, FACTION.FIRE)).toBe(-KINGMAKER_RPS_LOSS);
    expect(kingmakerTerm(g, FACTION.WATER)).toBe(KINGMAKER_RPS_WIN);
  });

  test("Fire vs Nature 2v1 is RPS advantage (Water was the threat)", () => {
    const g = fresh();
    g.eliminatedFactions.add(FACTION.WATER);
    expect(kingmakerTerm(g, FACTION.FIRE)).toBe(KINGMAKER_RPS_WIN);
  });

  test("sole survivor is a game win", () => {
    const g = fresh();
    g.eliminatedFactions.add(FACTION.WATER);
    g.eliminatedFactions.add(FACTION.NATURE);
    expect(kingmakerTerm(g, FACTION.FIRE)).toBe(GAME_WIN_SCORE);
    expect(kingmakerTerm(g, FACTION.WATER)).toBe(-GAME_WIN_SCORE);
  });
});

describe("greedyBestMove kingmaker", () => {
  test("does not mate Nature on ply 1 from the start position", () => {
    const g = fresh();
    const actions = getAllActions(g, FACTION.FIRE);
    const chosen = greedyBestMove(g, FACTION.FIRE, actions);
    expect(chosen).not.toBeNull();
    expect(g.pieces.filter((p) => p.alive).length).toBe(45);
    expect(g.eliminatedFactions.size).toBe(0);

    g.handleCellClick(chosen!.piece.pos);
    const result = g.handleCellClick(chosen!.target);
    if (result?.promotion) g.completePromotion("queen");
    expect(g.eliminatedFactions.has(FACTION.NATURE)).toBe(false);
    expect(
      g.pieces.some(
        (p) => p.faction === FACTION.NATURE && p.type === "king" && p.alive,
      ),
    ).toBe(true);
  });
});
