import { expect, test, describe, beforeEach } from "vitest";
import { Game, GAME_STATE, PROMOTION_CHOICES } from "../js/game.ts";
import { FACTION, generateBoard } from "../js/board.ts";
import { Piece, PIECE_TYPE } from "../js/pieces.ts";
import { Hex } from "../js/hex.ts";

describe("Game rules: direct unit tests", () => {
  let game;
  let boardCells;

  beforeEach(() => {
    game = new Game();
    boardCells = generateBoard();
    game.init(boardCells);
  });

  describe("isPromotion", () => {
    test("pawn on last rank (r <= 0) is a promotion", () => {
      const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 0));
      expect(game.isPromotion(pawn, new Hex(0, 0))).toBe(true);
      expect(game.isPromotion(pawn, new Hex(-1, 0))).toBe(true);
    });

    test("pawn not on last rank is not a promotion", () => {
      const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 5));
      expect(game.isPromotion(pawn, new Hex(0, 4))).toBe(false);
      expect(game.isPromotion(pawn, new Hex(1, 3))).toBe(false);
    });

    test("non-pawn pieces never promote", () => {
      const rook = new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 5));
      expect(game.isPromotion(rook, new Hex(0, 0))).toBe(false);
    });
  });

  describe("completePromotion", () => {
    test("returns null when no promotion is pending", () => {
      expect(game.pendingPromotion).toBeNull();
      expect(game.completePromotion(PIECE_TYPE.QUEEN)).toBeNull();
    });

    test("transforms pawn into chosen type and records result", () => {
      const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 0));
      pawn.symbol = "♟";
      game.pendingPromotion = pawn;

      const result = game.completePromotion(PIECE_TYPE.QUEEN);
      expect(result).not.toBeNull();
      expect(pawn.type).toBe(PIECE_TYPE.QUEEN);
      expect(pawn.symbol).toBe("♛");
      expect(result.action).toBe("promotion");
      expect(result.type).toBe(PIECE_TYPE.QUEEN);
      expect(result.notation).toContain("♟→♛");
      // Turn advances after promotion
      expect(game.state).toBe(GAME_STATE.SELECT_PIECE);
      expect(game.pendingPromotion).toBeNull();
    });

    test("all promotion choices produce the correct symbol", () => {
      const symbolFor = {
        [PIECE_TYPE.QUEEN]: "♛",
        [PIECE_TYPE.ROOK]: "♜",
        [PIECE_TYPE.BISHOP]: "♝",
        [PIECE_TYPE.KNIGHT]: "♞",
      };
      for (const choice of PROMOTION_CHOICES) {
        const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(2, 0));
        game.pendingPromotion = pawn;
        game.completePromotion(choice);
        expect(pawn.symbol).toBe(symbolFor[choice]);
      }
    });

    test("promotion that eliminates the last opponent ends the game", () => {
      // Eliminate two factions, leaving only FIRE alive with a pending pawn
      game.eliminatedFactions.add(FACTION.WATER);
      game.eliminatedFactions.add(FACTION.NATURE);
      const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 0));
      game.pendingPromotion = pawn;

      const result = game.completePromotion(PIECE_TYPE.QUEEN);
      expect(result.gameOver).toBe(true);
      expect(result.winner_faction).toBe(FACTION.FIRE);
      expect(game.state).toBe(GAME_STATE.GAME_OVER);
    });
  });

  describe("getLegalMoves", () => {
    test("returns well-formed move/attack lists for an initial pawn", () => {
      // Find a FIRE pawn in the initial setup
      const pawn = game.pieces.find(
        (p) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.PAWN,
      );
      expect(pawn).toBeDefined();
      const { moves, attacks } = game.getLegalMoves(pawn);
      expect(Array.isArray(moves)).toBe(true);
      expect(Array.isArray(attacks)).toBe(true);
      // Every legal move must be a Hex with a key
      for (const m of moves) {
        expect(typeof m.key).toBe("string");
        expect(m.key.length).toBeGreaterThan(0);
      }
    });

    test("legal moves never leave the king in check (filter applied)", () => {
      // Fire king at (0,0) is in check from a Water rook on the
      // same line at (0,-2): the rook controls (0,-1) and (0,0).
      // A raw king move to (0,-1) would step onto the rook's line
      // and remain in check, so the legal-move filter must drop it.
      const king = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
      const rook = new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, -2));
      game.pieces = [king, rook];
      for (const p of game.pieces) p.alive = true;
      game.eliminatedFactions = new Set();
      game.rpsEnabled = false;
      game._rebuildOccupiedMap();

      expect(game.isKingInCheck(FACTION.FIRE)).toBe(true);

      const { moves } = game.getLegalMoves(king);
      // The (0,-1) hex is on the rook's line, so the king may NOT
      // move there without staying in check.
      const stepsIntoCheck = moves.some((m) => m.equals(new Hex(0, -1)));
      expect(stepsIntoCheck).toBe(false);
    });
  });

  describe("isKingInCheck / isCheckmate / isStalemate", () => {
    test("no faction is in check at the initial position", () => {
      for (const f of [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]) {
        expect(game.isKingInCheck(f)).toBe(false);
        expect(game.isCheckmate(f)).toBe(false);
        expect(game.isStalemate(f)).toBe(false);
      }
    });

    test("isKingInCheck detects an adjacent enemy attacker", () => {
      // King at (0,0); place a WATER rook on a hex neighbour of the king.
      // Any piece can capture an adjacent enemy, so the king is in check.
      const king = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
      const attacker = new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(1, 0));
      game.pieces = [king, attacker];
      for (const p of game.pieces) p.alive = true;
      game.eliminatedFactions = new Set();
      game.rpsEnabled = false;
      game._rebuildOccupiedMap();

      expect(game.isKingInCheck(FACTION.FIRE)).toBe(true);
      // A faction with no adjacent enemy is not in check
      const loneKing = new Piece(
        PIECE_TYPE.KING,
        FACTION.NATURE,
        new Hex(0, 5),
      );
      const g2 = new Game();
      g2.pieces = [loneKing];
      g2._rebuildOccupiedMap();
      expect(g2.isKingInCheck(FACTION.NATURE)).toBe(false);
    });

    test("checkmate/stalemate are consistent with check state", () => {
      // King at (0,0) boxed in by enemies on every neighbouring hex has no
      // escape -> it is either checkmate or stalemate, never "fine while in check".
      const neighbours = [
        new Hex(1, 0),
        new Hex(-1, 0),
        new Hex(0, 1),
        new Hex(0, -1),
        new Hex(1, -1),
        new Hex(-1, 1),
      ];
      const king = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
      const attackers = neighbours.map(
        (h) => new Piece(PIECE_TYPE.ROOK, FACTION.WATER, h),
      );
      game.pieces = [king, ...attackers];
      for (const p of game.pieces) p.alive = true;
      game.eliminatedFactions = new Set();
      game.rpsEnabled = false;
      game._rebuildOccupiedMap();

      const inCheck = game.isKingInCheck(FACTION.FIRE);
      if (inCheck) {
        // Cannot be "not in check" while also not mate/stalemate
        expect(
          game.isCheckmate(FACTION.FIRE) || game.isStalemate(FACTION.FIRE),
        ).toBe(true);
      }
    });
  });

  describe("snapshot / restore / undo", () => {
    test("snapshot captures a faithful, restorable state", () => {
      const snap = game.snapshot();
      expect(snap.pieces).toHaveLength(game.pieces.length);
      expect(snap.currentFactionIdx).toBe(0);
      expect(snap.eliminatedFactions.size).toBe(0);
      expect(snap.moveHistoryLength).toBe(0);

      // Mutate the live game, then restore
      const before = game.getAlivePieces().length;
      game.pieces[0].alive = false;
      game.currentFactionIdx = 2;
      game.eliminatedFactions.add(FACTION.WATER);
      game.restore(snap);

      expect(game.getAlivePieces().length).toBe(before);
      expect(game.currentFactionIdx).toBe(0);
      expect(game.eliminatedFactions.has(FACTION.WATER)).toBe(false);
      expect(game.currentFaction).toBe(FACTION.FIRE);
    });

    test("undo returns null on empty stack and restores after a move", () => {
      expect(game.undo()).toBeNull();

      const snapBefore = game.snapshot();
      const pawn = game.pieces.find(
        (p) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.PAWN,
      );
      const moves = game.getLegalMoves(pawn).moves;
      expect(moves.length).toBeGreaterThan(0);

      // Push a snapshot manually (mirrors what handleCellClick does before a move)
      game._undoStack.push(game.snapshot());
      const target = moves[0];
      const fromKey = pawn.pos.key;
      // Perform the move directly on the piece
      pawn.pos = new Hex(target.q, target.r);
      game._rebuildOccupiedMap();

      const restored = game.undo();
      expect(restored).not.toBeNull();
      expect(restored.currentFactionIdx).toBe(snapBefore.currentFactionIdx);
      expect(game.getPieceAt(new Hex(...fromKey.split(",").map(Number)))).toBe(
        pawn,
      );
    });

    test("clearUndoStack empties the history", () => {
      game._undoStack.push(game.snapshot());
      expect(game._undoStack.length).toBe(1);
      game.clearUndoStack();
      expect(game._undoStack.length).toBe(0);
      expect(game.undo()).toBeNull();
    });
  });
});
