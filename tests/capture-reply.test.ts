/**
 * Capture-reply: after a greedy candidate, the next player can take a
 * hanging piece for free (RPS cycle: next always has advantage vs us).
 */
import { describe, test, expect, beforeEach } from "vitest";
import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import { Piece, PIECE_TYPE } from "../js/pieces.ts";
import { Hex } from "../js/hex.ts";
import {
  captureReplyPenalty,
  greedyBestMove,
  rebuildOccupiedMap,
  simulateMove,
  undoMove,
  getSeeValue,
} from "../js/ai-core.ts";
import type { AIAction } from "../js/types.ts";

function setupBare(): Game {
  const g = new Game();
  g.init(generateBoard());
  g.rpsEnabled = true;
  g.currentFactionIdx = 0;
  g.currentFaction = FACTION.FIRE;
  return g;
}

function setPieces(g: Game, pieces: Piece[]): void {
  g.pieces = pieces;
  rebuildOccupiedMap(g);
}

describe("captureReplyPenalty", () => {
  let g: Game;

  beforeEach(() => {
    g = setupBare();
  });

  test("is 0 when the next player has no capture of our pieces", () => {
    setPieces(g, [
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 6)),
      new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(-1, 2)),
      new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(2, 4)),
      new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(2, 0)),
      new Piece(PIECE_TYPE.KING, FACTION.NATURE, new Hex(-5, 3)),
    ]);
    // Side to move is still Fire — next-player scan requires Water to move.
    // Simulate a SAFE queen step (-1,2) → (0,1), off the rook's rays.
    const queen = g.pieces.find((p) => p.type === "queen")!;
    const undo = simulateMove(g, queen, new Hex(0, 1));
    rebuildOccupiedMap(g);
    expect(g.currentFaction).toBe(FACTION.WATER);
    expect(captureReplyPenalty(g, FACTION.FIRE)).toBe(0);
    undoMove(g, undo);
    rebuildOccupiedMap(g);
  });

  test("equals queen SEE value when Water can take the hanging queen", () => {
    setPieces(g, [
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 6)),
      new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(-1, 2)),
      new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(2, 4)),
      new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(2, 0)),
      new Piece(PIECE_TYPE.KING, FACTION.NATURE, new Hex(-5, 3)),
    ]);
    const queen = g.pieces.find((p) => p.type === "queen")!;
    // (-1,2) → (0,2) sits on the Water rook's SW ray from (2,0).
    const undo = simulateMove(g, queen, new Hex(0, 2));
    rebuildOccupiedMap(g);
    expect(g.currentFaction).toBe(FACTION.WATER);
    expect(captureReplyPenalty(g, FACTION.FIRE)).toBe(getSeeValue("queen"));
    undoMove(g, undo);
    rebuildOccupiedMap(g);
  });

  test("RPS-disadvantage replies score 0 (attacker would die)", () => {
    setPieces(g, [
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 6)),
      new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 0)),
      new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(2, 4)),
      new Piece(PIECE_TYPE.KING, FACTION.NATURE, new Hex(-5, 3)),
      // (-2,2) → NE lands on (0,0). Nature vs Fire is RPS disadvantage.
      new Piece(PIECE_TYPE.ROOK, FACTION.NATURE, new Hex(-2, 2)),
    ]);
    g.currentFactionIdx = 2;
    g.currentFaction = FACTION.NATURE;
    expect(captureReplyPenalty(g, FACTION.FIRE)).toBe(0);
  });
});

describe("greedyBestMove capture-reply", () => {
  test("refuses the hanging-queen square in favour of a safe square", () => {
    const g = setupBare();
    const queen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(-1, 2));
    setPieces(g, [
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 6)),
      queen,
      new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(2, 4)),
      new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(2, 0)),
      new Piece(PIECE_TYPE.KING, FACTION.NATURE, new Hex(-5, 3)),
    ]);

    const hang: AIAction = {
      piece: queen,
      target: new Hex(0, 2),
      type: "move",
      rps: "neutral",
    };
    const safe: AIAction = {
      piece: queen,
      target: new Hex(0, 1),
      type: "move",
      rps: "neutral",
    };

    const beforePos = queen.pos.key;
    const beforeSide = g.currentFaction;
    const chosen = greedyBestMove(g, FACTION.FIRE, [hang, safe]);
    expect(chosen).not.toBeNull();
    expect(chosen!.target.key).toBe(safe.target.key);
    expect(queen.pos.key).toBe(beforePos);
    expect(g.currentFaction).toBe(beforeSide);
  });

  test("still takes a free Nature pawn rather than a quiet move", () => {
    const g = setupBare();
    const queen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(-1, 2));
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(-1, 1));
    setPieces(g, [
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 6)),
      queen,
      pawn,
      new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(2, 4)),
      new Piece(PIECE_TYPE.KING, FACTION.NATURE, new Hex(-5, 3)),
    ]);

    const capture: AIAction = {
      piece: queen,
      target: pawn.pos,
      type: "attack",
      rps: "advantage",
    };
    const quiet: AIAction = {
      piece: queen,
      target: new Hex(-2, 2),
      type: "move",
      rps: "neutral",
    };

    const chosen = greedyBestMove(g, FACTION.FIRE, [quiet, capture]);
    expect(chosen).not.toBeNull();
    expect(chosen!.type).toBe("attack");
    expect(chosen!.target.key).toBe(pawn.pos.key);
  });
});
