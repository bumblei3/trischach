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

  test("isPromotion is faction-agnostic (all pawns promote at r<=0)", () => {
    // The engine's promotion rule is `target.r <= 0`, independent of faction.
    // Verify the same pawn landing on r=0 promotes whether it belongs to Fire,
    // Water, or Nature — the rule must not be hardcoded to Fire's side of the
    // board. This guards against a regression that would silently disable
    // promotion for the other two factions.
    for (const faction of [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]) {
      const pawn = new Piece(PIECE_TYPE.PAWN, faction, new Hex(0, 1));
      expect(game.isPromotion(pawn, new Hex(0, 0))).toBe(true);
      // And a non-promotion square never promotes, for any faction.
      const farPawn = new Piece(PIECE_TYPE.PAWN, faction, new Hex(0, 3));
      expect(game.isPromotion(farPawn, new Hex(0, 2))).toBe(false);
    }
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

  test("handleCellClick is a no-op while waiting for promotion choice", () => {
    // After a pawn reaches the promotion zone the engine enters PROMOTION
    // state and waits for completePromotion(). Any board click in that window
    // must be a no-op (return null, state unchanged) so the UI cannot sneak a
    // second move in before the player picks a promotion piece.
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-5, 5));
    game.pieces = [pawn, fireKing];
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0;
    game.currentFaction = FACTION.FIRE;
    game.state = GAME_STATE.SELECT_PIECE;

    // Drive the pawn into the promotion zone.
    game.handleCellClick(new Hex(0, 1));
    const moveResult = game.handleCellClick(new Hex(0, 0));
    expect(moveResult.promotion).toBe(true);
    expect(game.state).toBe(GAME_STATE.PROMOTION);
    expect(game.pendingPromotion).toBe(pawn);

    // A click on the board while PROMOTION is pending must do nothing.
    const clickResult = game.handleCellClick(new Hex(-5, 5)); // the king's cell
    expect(clickResult).toBeNull();
    expect(game.state).toBe(GAME_STATE.PROMOTION); // still awaiting choice
    expect(game.pendingPromotion).toBe(pawn); // promotion not cancelled
    // The pawn stays on the promotion square, unmoved by the stray click.
    expect(pawn.pos.equals(new Hex(0, 0))).toBe(true);
    expect(pawn.type).toBe(PIECE_TYPE.PAWN); // not yet promoted
  });

  test("completePromotion resets the 50-move clock (pawn move)", () => {
    // A promotion is a pawn move, so the 50-move (half-move) clock must reset
    // to 0 on completion — guarding a bug where completePromotion never called
    // _updateDrawState and thus left the clock frozen (e.g. at 99), silently
    // preventing the draw-rule reset that every pawn move triggers.
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-5, 5));
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(5, -5));
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(0, 7),
    );
    game.pieces = [pawn, fireKing, waterKing, natureKing];
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0;
    game.currentFaction = FACTION.FIRE;
    game.state = GAME_STATE.SELECT_PIECE;
    game._halfmoveClock = 99; // just below the 100 draw limit

    game.handleCellClick(new Hex(0, 1));
    game.handleCellClick(new Hex(0, 0)); // -> promotion zone (transient)
    expect(game._halfmoveClock).toBe(99); // unchanged until completed

    game.completePromotion(PIECE_TYPE.QUEEN);
    expect(game.state).toBe(GAME_STATE.SELECT_PIECE);
    expect(game._halfmoveClock).toBe(0); // reset: promotion counts as pawn move
  });

  test("completePromotion records the post-promotion position for repetition", () => {
    // The promoted position must enter _positionHistory so threefold repetition
    // can fire on promotion-bearing loops. Guards a bug where the two-phase
    // promotion flow (_selectTarget early-return + completePromotion) never
    // called _updateDrawState, so promoted positions were invisible to the
    // repetition counter.
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-5, 5));
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(5, -5));
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(0, 7),
    );
    game.pieces = [pawn, fireKing, waterKing, natureKing];
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0;
    game.currentFaction = FACTION.FIRE;
    game.state = GAME_STATE.SELECT_PIECE;

    const before = game._positionHistory.size;
    game.handleCellClick(new Hex(0, 1));
    game.handleCellClick(new Hex(0, 0)); // -> promotion zone
    expect(game._positionHistory.size).toBe(before); // still unrecorded pre-completion

    game.completePromotion(PIECE_TYPE.QUEEN);
    expect(game._positionHistory.size).toBe(before + 1); // now recorded
    // The recorded hash reflects the post-promotion position as seen by
    // _updateDrawState — BEFORE _nextTurn advances the side to move
    // (currentFactionIdx is still 0 at record time, so the hash includes "#0").
    const recordedHash = `${game
      .getAlivePieces()
      .filter((p) => p.alive)
      .map((p) => `${p.faction[0]}${p.type[0]}${p.pos.q},${p.pos.r}`)
      .sort()
      .join("|")}#0`;
    expect(game._positionHistory.has(recordedHash)).toBe(true);
    expect(game._positionHistory.get(recordedHash)).toBe(1);
  });

  test("completePromotion reports inCheck for the following faction", () => {
    // completePromotion must set result.inCheck to whether the now-to-move
    // faction is in check — mirroring the post-move inCheck set in
    // _selectTarget. Before the fix a promotion returned inCheck === undefined
    // even when the following faction was in check, so the UI/AI could not
    // tell that the opponent was left in check by the promoted piece.
    // RPS disabled so the pawn's move to (0,0) is a quiet promotion (no capture).
    game.rpsEnabled = false;
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    const rook = new Piece(PIECE_TYPE.ROOK, FACTION.FIRE, new Hex(2, -2)); // attacks (2,0)
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(2, 0));
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-5, 5));
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(5, 5),
    );
    game.pieces = [pawn, rook, waterKing, fireKing, natureKing];
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0; // FIRE
    game.currentFaction = FACTION.FIRE;
    game.state = GAME_STATE.SELECT_PIECE;

    expect(game.isKingInCheck(FACTION.WATER)).toBe(true); // rook pins the king

    game.handleCellClick(new Hex(0, 1));
    game.handleCellClick(new Hex(0, 0)); // -> promotion (0,0 empty, no capture)
    const result = game.completePromotion(PIECE_TYPE.QUEEN);

    // The promotion hands the move to WATER, which is in check.
    expect(game.currentFaction).toBe(FACTION.WATER);
    expect(game.isKingInCheck(FACTION.WATER)).toBe(true);
    expect(result.inCheck).toBe(true);
  });

  test("disadvantage combat into promotion zone does NOT promote the dead pawn", () => {
    // A pawn that captures into the promotion zone but LOSES the RPS duel
    // (disadvantage) dies on its origin square and never reaches the target.
    // It must NOT be promoted: that would leave a zombie "promoted" corpse
    // (dead piece transformed to a queen, stuck in PROMOTION state). Regression
    // guard for the round-25 fix (isPromotion now also requires the pawn to
    // survive the move).
    game.rpsEnabled = true; // Fire vs Water is a disadvantage for Fire
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    const enemy = new Piece(PIECE_TYPE.PAWN, FACTION.WATER, new Hex(0, 0)); // on promo edge (r<=0)
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-5, 5));
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(5, -5));
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(5, 5),
    );
    game.pieces = [pawn, enemy, fireKing, waterKing, natureKing];
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0; // FIRE
    game.currentFaction = FACTION.FIRE;
    game.state = GAME_STATE.SELECT_PIECE;

    game.handleCellClick(new Hex(0, 1));
    const result = game.handleCellClick(new Hex(0, 0)); // disadvantage combat in zone

    // The attacker died (disadvantage); defender survives.
    expect(pawn.alive).toBe(false);
    expect(enemy.alive).toBe(true);
    // No promotion: state advances normally, no pending promotion, no zombie.
    // (result.promotion is only set on a real promotion; undefined otherwise.)
    expect(result.promotion ?? false).toBe(false);
    expect(game.state).not.toBe(GAME_STATE.PROMOTION);
    expect(game.pendingPromotion).toBeNull();
    expect(pawn.type).toBe(PIECE_TYPE.PAWN); // not transformed into a queen
    // completePromotion must be a no-op now (nothing pending).
    expect(game.completePromotion(PIECE_TYPE.QUEEN)).toBeNull();
  });

  test("advantage combat into promotion zone promotes the surviving pawn", () => {
    // When the capturing pawn WINS the RPS duel (advantage), it reaches the
    // target square in the promotion zone and must promote — the defender is
    // captured and the pawn transforms. Regression guard that the survival
    // check in the round-25 fix still allows legitimate promotions by capture.
    // Fire can move (0,1) -> (0,0) and Fire beats Nature (advantage).
    game.rpsEnabled = true;
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    const enemy = new Piece(PIECE_TYPE.PAWN, FACTION.NATURE, new Hex(0, 0)); // on promo edge (r<=0)
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-5, 5));
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(5, -5),
    );
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(5, 5));
    game.pieces = [pawn, enemy, fireKing, natureKing, waterKing];
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0; // FIRE
    game.currentFaction = FACTION.FIRE;
    game.state = GAME_STATE.SELECT_PIECE;

    game.handleCellClick(new Hex(0, 1));
    const result = game.handleCellClick(new Hex(0, 0)); // advantage combat in zone

    expect(result.action).toBe("combat");
    expect(enemy.alive).toBe(false); // defender captured
    expect(pawn.alive).toBe(true); // attacker survives
    expect(result.promotion).toBe(true); // pawn reached zone -> promote
    expect(game.state).toBe(GAME_STATE.PROMOTION);
    expect(game.pendingPromotion).toBe(pawn);

    // Completing the promotion transforms the surviving pawn.
    const pres = game.completePromotion(PIECE_TYPE.QUEEN);
    expect(pres).not.toBeNull();
    expect(pawn.type).toBe(PIECE_TYPE.QUEEN);
    expect(pawn.pos.equals(new Hex(0, 0))).toBe(true);
  });
});
