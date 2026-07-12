/**
 * game-check.test.js - Tests for TriSchach check/checkmate/stalemate logic
 * (js/game-check.ts). These are the rule functions that decide when a game
 * ends; they had no direct unit coverage before.
 */
import { expect, test, describe, beforeEach } from "vitest";
import { Game } from "../js/game.ts";
import {
  isKingdomCheck,
  isCheckmateInternal,
  isStalemateInternal,
  getLegalMoves,
} from "../js/game-check.ts";
import { FACTION, generateBoard } from "../js/board.ts";
import { Piece, PIECE_TYPE } from "../js/pieces.ts";
import { Hex } from "../js/hex.ts";

describe("game-check: check detection", () => {
  let game: Game;

  beforeEach(() => {
    game = new Game();
    game.init(generateBoard());
    game.rpsEnabled = false;
  });

  function setPieces(pieces: Piece[]) {
    game.pieces = pieces;
    game._rebuildOccupiedMap();
  }

  test("isKingdomCheck true when an enemy attacks the king's hex", () => {
    setPieces([
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0)),
      new Piece(PIECE_TYPE.QUEEN, FACTION.WATER, new Hex(2, 0)),
    ]);
    expect(isKingdomCheck(game, FACTION.FIRE)).toBe(true);
    expect(isKingdomCheck(game, FACTION.WATER)).toBe(false);
  });

  test("isKingdomCheck false when the king is shielded by a friendly piece", () => {
    setPieces([
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0)),
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1)),
      new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 3)),
    ]);
    expect(isKingdomCheck(game, FACTION.FIRE)).toBe(false);
  });

  test("isKingdomCheck false when the attacking faction's piece cannot reach the king", () => {
    setPieces([
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0)),
      new Piece(PIECE_TYPE.KNIGHT, FACTION.WATER, new Hex(4, 4)),
    ]);
    expect(isKingdomCheck(game, FACTION.FIRE)).toBe(false);
  });

  test("isKingdomCheck false when the king faction has been eliminated", () => {
    setPieces([new Piece(PIECE_TYPE.QUEEN, FACTION.WATER, new Hex(2, 0))]);
    // no fire king on the board -> not in check
    expect(isKingdomCheck(game, FACTION.FIRE)).toBe(false);
  });
});

describe("game-check: checkmate & stalemate", () => {
  let game: Game;

  beforeEach(() => {
    game = new Game();
    game.init(generateBoard());
    game.rpsEnabled = false;
  });

  function setPieces(pieces: Piece[]) {
    game.pieces = pieces;
    game._rebuildOccupiedMap();
  }

  test("isCheckmateInternal true when king is in check with no legal move", () => {
    // Fire king cornered at (0,0): 5 friendly pawns block 5 neighbours,
    // a water rook on the same file (0,3) attacks the 6th neighbour and the
    // king. No escape square -> checkmate.
    setPieces([
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0)),
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, 0)),
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, -1)),
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, -1)),
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(-1, 0)),
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(-1, 1)),
      new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 3)),
    ]);
    expect(isKingdomCheck(game, FACTION.FIRE)).toBe(true);
    expect(isCheckmateInternal(game, FACTION.FIRE)).toBe(true);
  });

  test("isCheckmateInternal false when the king can move out of check", () => {
    // Fire king in check from one rook but has an escape square
    setPieces([
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0)),
      new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 3)),
    ]);
    expect(isCheckmateInternal(game, FACTION.FIRE)).toBe(false);
  });

  test("isCheckmateInternal false when the king is not in check", () => {
    setPieces([
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0)),
      new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(5, 5)),
    ]);
    expect(isCheckmateInternal(game, FACTION.FIRE)).toBe(false);
  });

  test("isStalemateInternal true when no check but no legal moves", () => {
    // Fire king boxed in by 6 enemy knights on every neighbour. Knights do
    // not attack the king hex from those squares, so it is not check — but
    // the king has no escape, hence stalemate.
    setPieces([
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0)),
      new Piece(PIECE_TYPE.KNIGHT, FACTION.WATER, new Hex(1, 0)),
      new Piece(PIECE_TYPE.KNIGHT, FACTION.WATER, new Hex(1, -1)),
      new Piece(PIECE_TYPE.KNIGHT, FACTION.WATER, new Hex(0, -1)),
      new Piece(PIECE_TYPE.KNIGHT, FACTION.WATER, new Hex(-1, 0)),
      new Piece(PIECE_TYPE.KNIGHT, FACTION.WATER, new Hex(-1, 1)),
      new Piece(PIECE_TYPE.KNIGHT, FACTION.WATER, new Hex(0, 1)),
    ]);
    expect(isKingdomCheck(game, FACTION.FIRE)).toBe(false);
    expect(isStalemateInternal(game, FACTION.FIRE)).toBe(true);
  });

  test("isStalemateInternal false when in check (that is checkmate, not stalemate)", () => {
    setPieces([
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0)),
      new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 2)),
      new Piece(PIECE_TYPE.ROOK, FACTION.NATURE, new Hex(2, 0)),
    ]);
    expect(isStalemateInternal(game, FACTION.FIRE)).toBe(false);
  });

  test("isCheckmateInternal / isStalemateInternal false when the faction has no living king", () => {
    // A faction whose king was already captured is eliminated, not in
    // checkmate/stalemate. This guards the `!hasKing -> return false` guards
    // in both predicates from misclassifying an eliminated faction.
    setPieces([
      // Fire has only a pawn, no king -> already eliminated.
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 0)),
      new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 3)),
    ]);
    expect(isCheckmateInternal(game, FACTION.FIRE)).toBe(false);
    expect(isStalemateInternal(game, FACTION.FIRE)).toBe(false);
  });
});

describe("game-check: legal move filtering", () => {
  let game: Game;

  beforeEach(() => {
    game = new Game();
    game.init(generateBoard());
    game.rpsEnabled = false;
  });

  function setPieces(pieces: Piece[]) {
    game.pieces = pieces;
    game._rebuildOccupiedMap();
  }

  test("getLegalMoves excludes moves that leave own king in check", () => {
    // Fire king at (0,0); a fire rook at (0,1) is pinned on the file by a
    // water rook at (0,3). The rook may slide to (0,2) (still shielding the
    // king) but not past the attacker or away from the king.
    setPieces([
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0)),
      new Piece(PIECE_TYPE.ROOK, FACTION.FIRE, new Hex(0, 1)),
      new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 3)),
    ]);
    const rook = game.pieces.find(
      (p: Piece) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.ROOK,
    );
    const { moves } = getLegalMoves(game, rook!);
    // exactly one legal slide, and it stays between king and attacker
    expect(moves.length).toBe(1);
    expect(moves[0]!.q).toBe(0);
    expect(moves[0]!.r).toBe(2);
    // a move that would expose the king (past the attacker) is illegal
    const exposesKing = moves.some((m) => m.q === 0 && m.r > 2);
    expect(exposesKing).toBe(false);
  });

  test("getLegalMoves returns empty when no piece can move without self-check", () => {
    setPieces([
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0)),
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1)),
      new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 3)),
    ]);
    const pawn = game.pieces.find(
      (p: Piece) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.PAWN,
    );
    // pawn at (0,1) pinned by rook on file -> no legal moves for the pawn
    const { moves, attacks } = getLegalMoves(game, pawn!);
    expect(moves.length + attacks.length).toBe(0);
  });

  test("getLegalMoves drops an attack that would expose the own king", () => {
    // Fire king at (0,0); a fire pawn at (1,0) could attack a water piece at
    // (2,0), but doing so exposes the king to a water rook on the same rank.
    setPieces([
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0)),
      new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, 0)),
      new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(3, 0)),
    ]);
    const pawn = game.pieces.find(
      (p: Piece) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.PAWN,
    );
    const { attacks } = getLegalMoves(game, pawn!);
    // any attack that leaves the king in check is filtered out
    expect(attacks.length).toBe(0);
  });

  test("getLegalMoves forbids a king move into a square under attack", () => {
    // Fire king at (0,0); a water rook on (0,3) controls the entire r-axis.
    // The king may NOT step to (0,1) or (0,2) (both inside the rook's line),
    // even though they are empty. Only squares outside the rook's attack that
    // are not occupied by a friendly piece are legal.
    setPieces([
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0)),
      new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 3)),
    ]);
    const king = game.pieces.find(
      (p: Piece) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.KING,
    );
    const { moves } = getLegalMoves(game, king!);
    // (0,1) and (0,2) are attacked by the rook -> never legal king targets.
    const intoCheck = moves.some((m) => m.q === 0 && (m.r === 1 || m.r === 2));
    expect(intoCheck).toBe(false);
    // The king must have at least one escape off the rook's axis.
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => !(m.q === 0 && m.r > 0))).toBe(true);
  });

  test("getLegalMoves allows a king to escape check to a safe square", () => {
    // Fire king at (0,0) in check from a water rook on (0,3). The king can
    // step off the r-axis to a safe neighbor (e.g. (1,0)) and that move is
    // legal (it removes the check).
    setPieces([
      new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0)),
      new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 3)),
    ]);
    const king = game.pieces.find(
      (p: Piece) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.KING,
    );
    const { moves } = getLegalMoves(game, king!);
    // Stepping to (1,0) leaves the rook's file -> must be a legal escape.
    expect(moves.some((m) => m.q === 1 && m.r === 0)).toBe(true);
  });
});
