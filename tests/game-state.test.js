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

describe("undo() robustness", () => {
  let game;
  beforeEach(() => {
    game = makeGame();
    game.rpsEnabled = true;
  });

  test("undo tolerates a captured defender missing from the captured list", () => {
    // Advantage combat: fire pawn captures nature pawn, nature pawn is added
    // to fire's capturedPieces. Manually remove it, then undo — the restore
    // must skip the missing defender (game.ts L524 `if (idx !== -1)`) without
    // throwing or corrupting state.
    const attacker = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    const defender = new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(0, 0));
    game.pieces = [attacker, defender];
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0;
    game.currentFaction = FACTION.FIRE;
    game.state = GAME_STATE.SELECT_PIECE;

    game.handleCellClick(attacker.pos);
    game.handleCellClick(defender.pos);
    expect(defender.alive).toBe(false);
    expect(game.capturedPieces[FACTION.FIRE].length).toBe(1);

    // Corrupt the captured list so the defender id is gone before undo.
    game.capturedPieces[FACTION.FIRE] = [];
    expect(() => game.undo()).not.toThrow();
    // Defender is revived by the undo regardless of the stale captured entry.
    expect(defender.alive).toBe(true);
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

  test("cloneGameState + restore round-trips the exact game state (no aliasing)", () => {
    // cloneGameState feeds the undo/AI snapshot path. Restoring it must
    // reproduce the exact state and NOT alias live objects (mutating the
    // restored game must not leak back into the snapshot).
    const snap = game.snapshot();
    game.restore(snap);

    expect(game.currentFactionIdx).toBe(snap.currentFactionIdx);
    expect(game.eliminatedFactions.size).toBe(snap.eliminatedFactions.size);
    const liveKings = game.pieces.filter(
      (p) => p.type === PIECE_TYPE.KING && p.alive,
    );
    const snapKings = snap.pieces.filter(
      (p) => p.type === PIECE_TYPE.KING && p.alive,
    );
    expect(liveKings.length).toBe(snapKings.length);
    // Piece positions are equal but are distinct objects (deep copy).
    for (const sp of snap.pieces) {
      const live = game.pieces.find((p) => p.id === sp.id);
      expect(live).toBeDefined();
      expect(`${live.pos.q},${live.pos.r}`).toBe(`${sp.pos.q},${sp.pos.r}`);
      expect(live.pos).not.toBe(sp.pos); // not the same reference
    }
    // Mutating the restored game does not corrupt the snapshot.
    game.pieces[0].pos = new Hex(9, 9);
    const spAfter = snap.pieces.find((p) => p.id === game.pieces[0].id);
    expect(`${spAfter.pos.q},${spAfter.pos.r}`).not.toBe("9,9");
  });
});

describe("undo() restores an eliminated faction", () => {
  let game;
  beforeEach(() => {
    game = makeGame();
    game.rpsEnabled = true;
    // Fire queen can capture the Nature king (Fire beats Nature = advantage).
    // The Nature king's death eliminates the Nature faction; Water stays alive
    // so the game is NOT over. We then undo and verify the elimination is
    // fully reverted (the historically-buggy restore path for
    // eliminatedFactions + killed pieces).
    const fireQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 0));
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(0, 1),
    );
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(-3, 3));
    game.pieces = [fireQueen, natureKing, waterKing];
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0; // FIRE to move
    game.currentFaction = FACTION.FIRE;
    game.state = GAME_STATE.SELECT_PIECE;
  });

  test("capturing the enemy king eliminates the faction, undo reverts it", () => {
    // Pre-move invariants
    expect(game.eliminatedFactions.has(FACTION.NATURE)).toBe(false);
    expect(natureKing_alive(game)).toBe(true);

    // Fire queen captures the Nature king (advantage -> defender dies).
    game.handleCellClick(new Hex(0, 0));
    const result = game.handleCellClick(new Hex(0, 1));

    expect(result.action).toBe("combat");
    expect(result.rpsResult).toBe("advantage");
    expect(game.eliminatedFactions.has(FACTION.NATURE)).toBe(true);
    const natureKing = game.pieces.find(
      (p) => p.faction === FACTION.NATURE && p.type === PIECE_TYPE.KING,
    );
    expect(natureKing.alive).toBe(false);
    expect(game.state).not.toBe(GAME_STATE.GAME_OVER); // Water still alive

    // Undo: Nature must be fully revived and de-eliminated.
    const restored = game.undo();
    expect(restored).not.toBeNull();
    expect(game.eliminatedFactions.has(FACTION.NATURE)).toBe(false);
    const revivedKing = game.pieces.find(
      (p) => p.faction === FACTION.NATURE && p.type === PIECE_TYPE.KING,
    );
    expect(revivedKing.alive).toBe(true);
    expect(game.currentFaction).toBe(FACTION.FIRE);
    expect(game.state).toBe(GAME_STATE.SELECT_PIECE);
  });

  function natureKing_alive(g) {
    const k = g.pieces.find(
      (p) => p.faction === FACTION.NATURE && p.type === PIECE_TYPE.KING,
    );
    return k ? k.alive : false;
  }
});

describe("undo() after a game-ending move", () => {
  let game;
  beforeEach(() => {
    game = new Game();
    game.init(generateBoard());
    game.rpsEnabled = true;
    // Only two factions on the board: Fire queen can capture the Nature king
    // (Fire beats Nature = advantage). Killing the last Nature piece ends the
    // game (only Fire remains). We then undo and verify the game returns to a
    // playable state (not stuck in GAME_OVER).
    const fireQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 0));
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(0, 1),
    );
    game.pieces = [fireQueen, natureKing];
    game._rebuildOccupiedMap();
    game.eliminatedFactions.add(FACTION.WATER); // no water pieces on board
    game.currentFactionIdx = 0; // FIRE to move
    game.currentFaction = FACTION.FIRE;
    game.state = GAME_STATE.SELECT_PIECE;
  });

  test("undo reverts a game-over move back to a playable state", () => {
    // Fire queen captures the Nature king -> only Fire remains -> GAME_OVER.
    game.handleCellClick(new Hex(0, 0));
    const result = game.handleCellClick(new Hex(0, 1));
    expect(result.gameOver).toBe(true);
    expect(game.state).toBe(GAME_STATE.GAME_OVER);
    expect(game.eliminatedFactions.has(FACTION.NATURE)).toBe(true);

    // Undo the game-ending move: the Nature king must be revived, Nature
    // de-eliminated, and the game playable again (NOT stuck at GAME_OVER).
    const restored = game.undo();
    expect(restored).not.toBeNull();
    expect(game.eliminatedFactions.has(FACTION.NATURE)).toBe(false);
    const revivedKing = game.pieces.find(
      (p) => p.faction === FACTION.NATURE && p.type === PIECE_TYPE.KING,
    );
    expect(revivedKing.alive).toBe(true);
    expect(game.currentFaction).toBe(FACTION.FIRE);
    expect(game.state).toBe(GAME_STATE.SELECT_PIECE); // playable again
  });
});

describe("post-move stalemate eliminates the stalemated faction", () => {
  let game;
  beforeEach(() => {
    game = new Game();
    game.init(generateBoard());
    game.rpsEnabled = false;
    // Water king cornered at (7,-7): no legal moves AND not in check
    // -> isStalemate(WATER) === true (verified), isCheckmate === false.
    // Fire + Nature kings stay alive so eliminating Water is NOT game over;
    // this isolates the stalemate-elimination branch (game.ts:382).
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(7, -7));
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 5));
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(-3, 3),
    );
    // A Fire pawn that can make a legal move this turn.
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 4));
    game.pieces = [waterKing, fireKing, natureKing, firePawn];
    game._rebuildOccupiedMap();
    // FIRE to move; Water is already stalemated.
    game.currentFactionIdx = 0;
    game.currentFaction = FACTION.FIRE;
    game.state = GAME_STATE.SELECT_PIECE;
  });

  test("water is stalemated (not checkmated) before the move", () => {
    expect(game.isCheckmate(FACTION.WATER)).toBe(false);
    expect(game.isStalemate(FACTION.WATER)).toBe(true);
  });

  test("a fire move eliminates the stalemated water faction", () => {
    game.handleCellClick(game.pieces[3].pos); // select fire pawn
    const target = game.validMoves[0];
    const result = game.handleCellClick(target);

    // The stalemate branch must fire: result.stalemate names WATER,
    // the faction is eliminated, and it is NOT game over (Fire+Nature live).
    expect(result.stalemate).toBe(FACTION.WATER);
    expect(result.elimination).toBe(FACTION.WATER);
    expect(game.eliminatedFactions.has(FACTION.WATER)).toBe(true);
    expect(game.state).not.toBe(GAME_STATE.GAME_OVER);
    expect(result.gameOver).toBeFalsy();
  });

  test("undo reverts a stalemate elimination (not just a capture)", () => {
    // The undo path must restore a stalemate-eliminated faction too, not only
    // a king-capture elimination. Drive Water into stalemate, eliminate it,
    // then undo and assert Water is fully revived + de-eliminated.
    game.handleCellClick(game.pieces[3].pos); // select fire pawn
    const target = game.validMoves[0];
    const result = game.handleCellClick(target);
    expect(result.elimination).toBe(FACTION.WATER);
    expect(game.eliminatedFactions.has(FACTION.WATER)).toBe(true);

    const waterKing = game.pieces.find(
      (p) => p.faction === FACTION.WATER && p.type === PIECE_TYPE.KING,
    );
    expect(waterKing.alive).toBe(false);

    const restored = game.undo();
    expect(restored).not.toBeNull();
    expect(game.eliminatedFactions.has(FACTION.WATER)).toBe(false);
    const revivedKing = game.pieces.find(
      (p) => p.faction === FACTION.WATER && p.type === PIECE_TYPE.KING,
    );
    expect(revivedKing.alive).toBe(true);
    // The fire pawn returns to its pre-move square and the turn is Fire again.
    expect(game.currentFaction).toBe(FACTION.FIRE);
    expect(game.state).toBe(GAME_STATE.SELECT_PIECE);
  });
});
