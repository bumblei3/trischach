import { expect, test, describe, beforeEach } from "vitest";
import { Game, GAME_STATE, PROMOTION_CHOICES } from "../js/game.ts";
import { FACTION, generateBoard } from "../js/board.ts";
import { Piece, PIECE_TYPE } from "../js/pieces.ts";
import { Hex } from "../js/hex.ts";

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

  test("simulateMove: disadvantage attack kills the attacker (not the defender)", () => {
    // Fire loses to Water in RPS (disadvantage). A Fire attacker capturing a
    // Water piece must DIE itself, leaving the Water defender alive. This is
    // the symmetric counterpart to the advantage case (defender dies) and is
    // the critical RPS rule that makes the 3-player balance work.
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 2));
    const waterPawn = new Piece(PIECE_TYPE.PAWN, FACTION.WATER, new Hex(0, 1));
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-5, 5));
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(5, -5));
    game.pieces = [firePawn, waterPawn, fireKing, waterKing];
    game._rebuildOccupiedMap();
    game.rpsEnabled = true;
    game.currentFactionIdx = 0; // FIRE to move
    game.currentFaction = FACTION.FIRE;

    const undo = game.simulateMove(firePawn, new Hex(0, 1)); // capture water pawn
    expect(undo.wasAttack).toBe(true);
    expect(undo.attackerDied).toBe(true);
    expect(undo.defenderWasKilled).toBeFalsy();
    // Attacker is dead, defender survives.
    expect(firePawn.alive).toBe(false);
    expect(waterPawn.alive).toBe(true);
    // The attacker did NOT move onto the target (it died in place on 0,2).
    expect(firePawn.pos.equals(new Hex(0, 2))).toBe(true);
    // No faction eliminated (neither king died).
    expect(game.eliminatedFactions.size).toBe(0);

    // Undo restores the attacker and the pre-move turn.
    game.undoMove(undo);
    expect(firePawn.alive).toBe(true);
    expect(firePawn.pos.equals(new Hex(0, 2))).toBe(true);
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

  test("undo reverts a promotion (pawn becomes a pawn again)", () => {
    // The undo path must restore a promoted pawn to its original type AND
    // square — mirroring the elimination-undo guarantees. Drive a real
    // promote via handleCellClick, then undo and assert the pawn is back.
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    game.pieces = [pawn];
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0;
    game.currentFaction = FACTION.FIRE;
    game.state = GAME_STATE.SELECT_PIECE;

    game.handleCellClick(new Hex(0, 1)); // select pawn
    const moveResult = game.handleCellClick(new Hex(0, 0)); // -> promotion zone
    expect(moveResult.promotion).toBe(true);
    expect(game.state).toBe(GAME_STATE.PROMOTION);

    game.completePromotion(PIECE_TYPE.QUEEN);
    expect(pawn.type).toBe(PIECE_TYPE.QUEEN);
    expect(pawn.pos.equals(new Hex(0, 0))).toBe(true);

    // Undo the whole promotion move. The popped snapshot is the one taken at
    // the move (pawn already on 0,0), so the pawn returns there as a PAWN.
    const restored = game.undo();
    expect(restored).not.toBeNull();
    expect(pawn.type).toBe(PIECE_TYPE.PAWN); // demoted back
    expect(pawn.pos.equals(new Hex(0, 0))).toBe(true); // back to pre-promo square
    expect(game.state).toBe(GAME_STATE.SELECT_PIECE);
    expect(game.currentFaction).toBe(FACTION.FIRE);
  });

  test("handleCellClick is a no-op after the game has ended", () => {
    // Once the game reaches GAME_OVER (or a draw), further clicks must not
    // mutate state or produce a move. This guards the UI against post-game
    // input driving the engine.
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-5, 5));
    game.pieces = [pawn, fireKing];
    game.eliminatedFactions.add(FACTION.WATER);
    game.eliminatedFactions.add(FACTION.NATURE);
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0;
    game.currentFaction = FACTION.FIRE;
    game.state = GAME_STATE.GAME_OVER;
    game.winner_faction = FACTION.FIRE;

    const result = game.handleCellClick(new Hex(0, 1));
    expect(result).toBeNull();
    // State is untouched by the click.
    expect(game.state).toBe(GAME_STATE.GAME_OVER);
    expect(game.currentFaction).toBe(FACTION.FIRE);
    expect(game.pieces.length).toBe(2);

    // Same for a draw state.
    game.state = GAME_STATE.DRAW_REPETITION;
    const result2 = game.handleCellClick(new Hex(0, 1));
    expect(result2).toBeNull();
    expect(game.state).toBe(GAME_STATE.DRAW_REPETITION);
  });
});
