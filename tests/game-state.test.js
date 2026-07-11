/**
 * game-state.test.js - focused coverage for js/game.ts state-management
 * and lifecycle helpers that the higher-level flow tests don't isolate:
 *  - GAME_STATE constant shape
 *  - snapshot() / restore() / undo() / clearUndoStack()
 *  - completePromotion (normal + game-over when <=1 faction remains)
 *  - post-move checkmate eliminates the mated faction (real handleCellClick flow)
 *  - _positionHash (repetition-detection hash stability)
 *  - board.getRPSResult neutral (same-faction) branch
 *
 * Deterministic, no AI search, no DOM.
 */
import { expect, test, describe, beforeEach } from "vitest";
import { Game, GAME_STATE } from "../js/game.ts";
import { generateBoard, FACTION, getRPSResult } from "../js/board.ts";
import { Piece, PIECE_TYPE } from "../js/pieces.ts";
import { Hex } from "../js/hex.ts";

function makeGame() {
  const game = new Game();
  game.init(generateBoard());
  return game;
}

describe("GAME_STATE constants", () => {
  test("exposes the expected lifecycle states", () => {
    expect(GAME_STATE.SELECT_PIECE).toBe("select_piece");
    expect(GAME_STATE.SELECT_TARGET).toBe("select_target");
    expect(GAME_STATE.PROMOTION).toBe("promotion");
    expect(GAME_STATE.GAME_OVER).toBe("game_over");
    expect(GAME_STATE.DRAW_REPETITION).toBe("draw_repetition");
    expect(GAME_STATE.DRAW_50MOVE).toBe("draw_50move");
  });
});

describe("snapshot / restore / undo", () => {
  let game;
  beforeEach(() => {
    game = makeGame();
  });

  test("snapshot captures a restorable position and restore reverts moves", () => {
    const before = game.snapshot();
    const pawn = game.pieces.find(
      (p) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.PAWN,
    );
    const startPos = new Hex(pawn.pos.q, pawn.pos.r);

    // Make a move and confirm the board changed
    game.handleCellClick(pawn.pos);
    const target = game.validMoves[0];
    game.handleCellClick(target);
    expect(pawn.pos.q).not.toBe(startPos.q);

    // Restore and confirm we are back to the snapshot
    game.restore(before);
    expect(pawn.pos.q).toBe(startPos.q);
    expect(pawn.pos.r).toBe(startPos.r);
    expect(game.moveHistory.length).toBe(before.moveHistoryLength);
  });

  test("undo() reverts the last move and returns the snapshot", () => {
    const snap = game.snapshot();
    const pawn = game.pieces.find(
      (p) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.PAWN,
    );
    game.handleCellClick(pawn.pos);
    const target = game.validMoves[0];
    game.handleCellClick(target);
    const restored = game.undo();
    expect(restored).not.toBeNull();
    expect(restored.moveHistoryLength).toBe(snap.moveHistoryLength);
    expect(pawn.pos.q).toBe(snap.pieces.find((p) => p.id === pawn.id).pos.q);
  });

  test("undo() returns null when the stack is empty", () => {
    expect(game.undo()).toBeNull();
  });

  test("clearUndoStack empties the undo history", () => {
    const pawn = game.pieces.find(
      (p) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.PAWN,
    );
    game.handleCellClick(pawn.pos);
    game.handleCellClick(game.validMoves[0]);
    expect(game.undo()).not.toBeNull();
    game.clearUndoStack();
    expect(game.undo()).toBeNull();
  });
});

describe("completePromotion", () => {
  let game;
  beforeEach(() => {
    game = makeGame();
  });

  test("promotes a pending pawn to the chosen type and symbol", () => {
    const pawn = game.pieces.find(
      (p) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.PAWN,
    );
    game.pendingPromotion = pawn;
    const result = game.completePromotion(PIECE_TYPE.QUEEN);
    expect(result).not.toBeNull();
    expect(pawn.type).toBe(PIECE_TYPE.QUEEN);
    expect(pawn.symbol).toBe("♛");
    expect(game.pendingPromotion).toBeNull();
    expect(game.state).toBe(GAME_STATE.SELECT_PIECE);
  });

  test("returns null when there is no pending promotion", () => {
    game.pendingPromotion = null;
    expect(game.completePromotion(PIECE_TYPE.QUEEN)).toBeNull();
  });

  test("ends the game when promoting leaves only one faction alive", () => {
    // Eliminate two of the three factions.
    for (const p of game.pieces) {
      if (p.faction !== FACTION.FIRE) p.alive = false;
    }
    game.eliminatedFactions.add(FACTION.WATER);
    game.eliminatedFactions.add(FACTION.NATURE);
    game._rebuildOccupiedMap();

    const pawn = game.pieces.find(
      (p) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.PAWN,
    );
    game.pendingPromotion = pawn;
    const result = game.completePromotion(PIECE_TYPE.QUEEN);
    expect(result.gameOver).toBe(true);
    expect(game.state).toBe(GAME_STATE.GAME_OVER);
    expect(result.winner_faction).toBe(FACTION.FIRE);
  });
});

describe("post-move checkmate eliminates the mated faction", () => {
  let game;
  beforeEach(() => {
    game = new Game();
    game.init(generateBoard());
    game.rpsEnabled = false;
    // Fire king cornered at (0,0); 5 fire pawns block 5 of its 6
    // neighbours and a water rook on the (0,3) file attacks the 6th
    // neighbour and the king itself. Fire has no escape -> checkmate.
    game.pieces = [
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0)),
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, 0)),
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, -1)),
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, -1)),
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(-1, 0)),
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(-1, 1)),
      new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 3)),
      new Piece(PIECE_TYPE.PAWN, FACTION.WATER, new Hex(2, 2)),
    ];
    game._rebuildOccupiedMap();
    // Water is to move; Fire is already in checkmate.
    game.currentFactionIdx = 1;
    game.currentFaction = FACTION.WATER;
    game.state = GAME_STATE.SELECT_PIECE;
  });

  test("isCheckmate reports fire as mated before the move", () => {
    expect(game.isCheckmate(FACTION.FIRE)).toBe(true);
  });

  test("a water move that leaves fire mated eliminates fire", () => {
    const waterPawn = game.pieces.find(
      (p) => p.faction === FACTION.WATER && p.type === PIECE_TYPE.PAWN,
    );
    // Pick any legal water move (the rook already delivers mate).
    game.handleCellClick(waterPawn.pos);
    const target = game.validMoves[0];
    const result = game.handleCellClick(target);

    expect(result.checkmate).toBe(FACTION.FIRE);
    expect(result.elimination).toBe(FACTION.FIRE);
    expect(game.eliminatedFactions.has(FACTION.FIRE)).toBe(true);
    const fireKing = game.pieces.find(
      (p) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.KING,
    );
    expect(fireKing.alive).toBe(false);
  });
});

describe("_positionHash (repetition detection)", () => {
  test("is stable for identical positions and changes with a move", () => {
    const game = makeGame();
    const h1 = game._positionHash();
    const h2 = game._positionHash();
    expect(h1).toBe(h2);

    const pawn = game.pieces.find(
      (p) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.PAWN,
    );
    game.handleCellClick(pawn.pos);
    game.handleCellClick(game.validMoves[0]);
    expect(game._positionHash()).not.toBe(h1);
  });
});

describe("board.getRPSResult neutral branch", () => {
  test("same-faction attack is neutral (no advantage/disadvantage)", () => {
    expect(getRPSResult(FACTION.FIRE, FACTION.FIRE)).toBe("neutral");
    expect(getRPSResult(FACTION.WATER, FACTION.WATER)).toBe("neutral");
    expect(getRPSResult(FACTION.NATURE, FACTION.NATURE)).toBe("neutral");
  });
});

describe("restore() robustness", () => {
  let game;
  beforeEach(() => {
    game = makeGame();
  });

  test("restore tolerates a captured id that no longer matches a live piece", () => {
    // Capture a snapshot, then remove a piece from the board so its id is
    // stale, then restore — the capturedPieces rebuild must skip the missing
    // id (game.ts L602-603 `if (piece)` guard) instead of throwing.
    const snap = game.snapshot();
    const victim = game.pieces.find(
      (p) => p.faction === FACTION.WATER && p.type === PIECE_TYPE.PAWN,
    );
    // Record the victim as a captured piece of FIRE in the snapshot, then
    // delete the victim from the live board so restore cannot find it.
    snap.capturedPieces.fire.push(victim.id);
    game.pieces = game.pieces.filter((p) => p.id !== victim.id);
    game._rebuildOccupiedMap();

    expect(() => game.restore(snap)).not.toThrow();
    // The stale captured id is silently dropped, not added to capturedPieces.
    const stillCaptured = game.capturedPieces[FACTION.FIRE].some(
      (p) => p.id === victim.id,
    );
    expect(stillCaptured).toBe(false);
  });
});
