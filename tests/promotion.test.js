import { expect, test, describe, beforeEach } from "vitest";
import { Game, GAME_STATE, PROMOTION_CHOICES } from "../js/game.js";
import { FACTION, generateBoard } from "../js/board.js";
import { Piece, PIECE_TYPE } from "../js/pieces.js";
import { Hex } from "../js/hex.js";

describe("Pawn Promotion", () => {
  let game;

  beforeEach(() => {
    game = new Game();
    game.init(generateBoard());
    game.pieces = [];
    game._rebuildOccupiedMap();
    game.rpsEnabled = true;
  });

  test("isPromotion: pawn at r=0 triggers promotion", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    expect(game.isPromotion(pawn, new Hex(0, 0))).toBe(true);
  });

  test("isPromotion: pawn at r=-1 triggers promotion", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 0));
    expect(game.isPromotion(pawn, new Hex(0, -1))).toBe(true);
  });

  test("isPromotion: pawn at r=1 does NOT trigger promotion", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 2));
    expect(game.isPromotion(pawn, new Hex(0, 1))).toBe(false);
  });

  test("isPromotion: non-pawn piece never triggers promotion", () => {
    const queen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 1));
    expect(game.isPromotion(queen, new Hex(0, 0))).toBe(false);
  });

  test("PROMOTION_CHOICES contains queen, rook, bishop, knight", () => {
    expect(PROMOTION_CHOICES).toEqual([
      PIECE_TYPE.QUEEN,
      PIECE_TYPE.ROOK,
      PIECE_TYPE.BISHOP,
      PIECE_TYPE.KNIGHT,
    ]);
  });

  test("handleCellClick: pawn move to r<=0 triggers PROMOTION state", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    game.pieces = [pawn];
    game._rebuildOccupiedMap();

    // Select the pawn
    const sel = game.handleCellClick(new Hex(0, 1));
    expect(sel.action).toBe("select");

    // Move to r=0 (promotion zone)
    const result = game.handleCellClick(new Hex(0, 0));
    expect(result.action).toBe("move");
    expect(result.promotion).toBe(true);
    expect(game.state).toBe(GAME_STATE.PROMOTION);
    expect(game.pendingPromotion).toBe(pawn);
  });

  test("handleCellClick: returns null during PROMOTION state", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    game.pieces = [pawn];
    game._rebuildOccupiedMap();

    game.handleCellClick(new Hex(0, 1));
    game.handleCellClick(new Hex(0, 0));
    expect(game.state).toBe(GAME_STATE.PROMOTION);

    // Clicking during promotion should return null
    const result = game.handleCellClick(new Hex(1, 0));
    expect(result).toBeNull();
  });

  test("completePromotion: transforms pawn to queen", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 0));
    game.pieces = [pawn];
    game._rebuildOccupiedMap();
    game.pendingPromotion = pawn;
    game.state = GAME_STATE.PROMOTION;

    const result = game.completePromotion(PIECE_TYPE.QUEEN);

    expect(result).not.toBeNull();
    expect(result.action).toBe("promotion");
    expect(pawn.type).toBe(PIECE_TYPE.QUEEN);
    expect(pawn.symbol).toBe("♛");
    expect(game.pendingPromotion).toBeNull();
    expect(game.state).toBe(GAME_STATE.SELECT_PIECE);
  });

  test("completePromotion: transforms pawn to rook", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.WATER, new Hex(0, 0));
    game.pieces = [pawn];
    game._rebuildOccupiedMap();
    game.pendingPromotion = pawn;
    game.state = GAME_STATE.PROMOTION;

    game.completePromotion(PIECE_TYPE.ROOK);
    expect(pawn.type).toBe(PIECE_TYPE.ROOK);
    expect(pawn.symbol).toBe("♜");
  });

  test("completePromotion: transforms pawn to bishop", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(0, 0));
    game.pieces = [pawn];
    game._rebuildOccupiedMap();
    game.pendingPromotion = pawn;
    game.state = GAME_STATE.PROMOTION;

    game.completePromotion(PIECE_TYPE.BISHOP);
    expect(pawn.type).toBe(PIECE_TYPE.BISHOP);
    expect(pawn.symbol).toBe("♝");
  });

  test("completePromotion: transforms pawn to knight", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 0));
    game.pieces = [pawn];
    game._rebuildOccupiedMap();
    game.pendingPromotion = pawn;
    game.state = GAME_STATE.PROMOTION;

    game.completePromotion(PIECE_TYPE.KNIGHT);
    expect(pawn.type).toBe(PIECE_TYPE.KNIGHT);
    expect(pawn.symbol).toBe("♞");
  });

  test("completePromotion: returns null if no pending promotion", () => {
    game.pendingPromotion = null;
    const result = game.completePromotion(PIECE_TYPE.QUEEN);
    expect(result).toBeNull();
  });

  test("completePromotion: advances turn after promotion", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 0));
    game.pieces = [pawn];
    game._rebuildOccupiedMap();
    game.pendingPromotion = pawn;
    game.state = GAME_STATE.PROMOTION;
    expect(game.currentFaction).toBe(FACTION.FIRE);

    game.completePromotion(PIECE_TYPE.QUEEN);
    expect(game.currentFaction).not.toBe(FACTION.FIRE);
  });

  test("completePromotion: adds to move history", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 0));
    game.pieces = [pawn];
    game._rebuildOccupiedMap();
    game.pendingPromotion = pawn;
    game.state = GAME_STATE.PROMOTION;
    const historyLen = game.moveHistory.length;

    game.completePromotion(PIECE_TYPE.QUEEN);
    expect(game.moveHistory.length).toBe(historyLen + 1);
    expect(game.moveHistory[game.moveHistory.length - 1].action).toBe(
      "promotion",
    );
  });

  test("promotion: game over if last faction after promotion", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 0));
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-5, 5));
    game.pieces = [pawn, fireKing];
    game.eliminatedFactions.add(FACTION.WATER);
    game.eliminatedFactions.add(FACTION.NATURE);
    game._rebuildOccupiedMap();
    game.pendingPromotion = pawn;
    game.state = GAME_STATE.PROMOTION;

    const result = game.completePromotion(PIECE_TYPE.QUEEN);
    expect(result.gameOver).toBe(true);
    expect(result.winner_faction).toBe(FACTION.FIRE);
    expect(game.state).toBe(GAME_STATE.GAME_OVER);
  });

  test("simulateMove: promotion flag set in undo object", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    game.pieces = [pawn];
    game._rebuildOccupiedMap();

    const undo = game.simulateMove(pawn, new Hex(0, 0));
    expect(undo.promoted).toBe(true);

    game.undoMove(undo);
    expect(pawn.type).toBe(PIECE_TYPE.PAWN);
    expect(pawn.pos.equals(new Hex(0, 1))).toBe(true);
  });

  test("simulateMove: no promotion flag for non-promoting move", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 3));
    game.pieces = [pawn];
    game._rebuildOccupiedMap();

    const undo = game.simulateMove(pawn, new Hex(0, 2));
    expect(undo.promoted).toBeUndefined();
  });

  test("full promotion flow: select -> move -> promote -> next turn", () => {
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    game.pieces = [pawn];
    game._rebuildOccupiedMap();

    // 1. Select pawn
    game.handleCellClick(new Hex(0, 1));
    expect(game.state).toBe(GAME_STATE.SELECT_TARGET);

    // 2. Move to promotion zone
    const moveResult = game.handleCellClick(new Hex(0, 0));
    expect(game.state).toBe(GAME_STATE.PROMOTION);
    expect(moveResult.promotion).toBe(true);

    // 3. Complete promotion
    const promoResult = game.completePromotion(PIECE_TYPE.QUEEN);
    expect(promoResult.action).toBe("promotion");
    expect(pawn.type).toBe(PIECE_TYPE.QUEEN);
    expect(game.state).toBe(GAME_STATE.SELECT_PIECE);
  });
});
