// @ts-nocheck
import { expect, test, describe, beforeEach } from "vitest";
import { Game, GAME_STATE } from "../js/game.ts";
import { FACTION, generateBoard } from "../js/board.ts";
import { Piece, PIECE_TYPE } from "../js/pieces.ts";
import { Hex } from "../js/hex.ts";

describe("Game logic", () => {
  let game;
  let boardCells;

  beforeEach(() => {
    game = new Game();
    boardCells = generateBoard();
    game.init(boardCells);
  });

  test("initializes correctly", () => {
    expect(game.state).toBe(GAME_STATE.SELECT_PIECE);
    expect(game.currentFaction).toBe(FACTION.FIRE);
    expect(game.getAlivePieces().length).toBeGreaterThan(0);
    expect(game.getAlivePieces().length).toBe(45);
    expect(game.currentFactionName).toBeDefined();
  });

  test("executes a normal move correctly", () => {
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 5));
    game.pieces = [firePawn];
    game._rebuildOccupiedMap();
    const target = new Hex(0, 4);
    game.handleCellClick(firePawn.pos);
    const result = game.handleCellClick(target);
    expect(result.action).toBe("move");
    expect(firePawn.pos.equals(target)).toBe(true);
    expect(firePawn.hasMoved).toBe(true);
  });

  test("reselects another own piece correctly", () => {
    const firePieces = game
      .getAlivePieces()
      .filter((p) => p.faction === FACTION.FIRE);
    const p1 = firePieces[0];
    const p2 = firePieces[1];
    game.handleCellClick(p1.pos);
    expect(game.selectedPiece).toBe(p1);
    const result = game.handleCellClick(p2.pos);
    expect(result.action).toBe("select");
    expect(game.selectedPiece).toBe(p2);
  });

  test("init fails with invalid data", () => {
    const brokenGame = new Game();
    const originalError = console.error;
    console.error = () => {};
    expect(brokenGame.init(null)).toBeUndefined();
    console.error = originalError;
  });

  test("clicking invalid cell in SELECT_TARGET state aborts move", () => {
    const firePawn = game
      .getAlivePieces()
      .find((p) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.PAWN);
    firePawn.pos = new Hex(0, 0);
    game.handleCellClick(firePawn.pos);
    const result = game.handleCellClick(new Hex(0, 5));
    expect(result.action).toBe("deselect");
  });

  test("select piece changes state", () => {
    const firePiece = game
      .getAlivePieces()
      .find((p) => p.faction === FACTION.FIRE);
    const result = game.handleCellClick(firePiece.pos);
    expect(result.action).toBe("select");
    expect(game.state).toBe(GAME_STATE.SELECT_TARGET);
    expect(game.selectedPiece).toBe(firePiece);
  });

  test("cannot select opponent piece directly", () => {
    const waterPiece = game
      .getAlivePieces()
      .find((p) => p.faction === FACTION.WATER);
    const result = game.handleCellClick(waterPiece.pos);
    expect(result.action).toBe("deselect");
    expect(game.state).toBe(GAME_STATE.SELECT_PIECE);
  });

  test("getPieceAt returns null for empty hex", () => {
    expect(game.getPieceAt(new Hex(0, 0))).toBeNull();
  });

  test("returns deselect when selecting enemy piece directly", () => {
    const waterPiece = game
      .getAlivePieces()
      .find((p) => p.faction === FACTION.WATER);
    const result = game.handleCellClick(waterPiece.pos);
    expect(result.action).toBe("deselect");
  });

  test("deselecting piece returns to select state", () => {
    const firePiece = game
      .getAlivePieces()
      .find((p) => p.faction === FACTION.FIRE);
    game.handleCellClick(firePiece.pos);
    const emptyHex = new Hex(0, 0);
    const result = game.handleCellClick(emptyHex);
    if (result.action === "deselect") {
      expect(game.state).toBe(GAME_STATE.SELECT_PIECE);
      expect(game.selectedPiece).toBeNull();
    }
  });

  test("RPS combat resolution: Fire vs Nature", () => {
    game.rpsEnabled = true;
    const firePiece = game
      .getAlivePieces()
      .find((p) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.QUEEN);
    const naturePiece = game
      .getAlivePieces()
      .find((p) => p.faction === FACTION.NATURE && p.type === PIECE_TYPE.QUEEN);
    firePiece.pos = new Hex(0, 0);
    naturePiece.pos = new Hex(0, 1);
    game._rebuildOccupiedMap();
    game.handleCellClick(firePiece.pos);
    const result = game.handleCellClick(naturePiece.pos);
    expect(result.action).toBe("combat");
    expect(result.rpsResult).toBe("advantage");
    expect(naturePiece.alive).toBe(false);
    expect(firePiece.alive).toBe(true);
  });

  test("RPS combat resolution: Fire vs Water", () => {
    game.rpsEnabled = true;
    const firePiece = game
      .getAlivePieces()
      .find((p) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.QUEEN);
    const waterPiece = game
      .getAlivePieces()
      .find((p) => p.faction === FACTION.WATER && p.type === PIECE_TYPE.QUEEN);
    firePiece.pos = new Hex(0, 0);
    waterPiece.pos = new Hex(1, 0);
    game._rebuildOccupiedMap();
    game.handleCellClick(firePiece.pos);
    const result = game.handleCellClick(waterPiece.pos);
    // The test sets up an adjacent attacker/defender pair, so the second
    // click must resolve as combat (not a stray deselect that would
    // silently skip the assertions below).
    expect(result.action).toBe("combat");
    expect(result.rpsResult).toBe("disadvantage");
    expect(waterPiece.alive).toBe(true);
    expect(firePiece.alive).toBe(false);
  });

  test("RPS combat resolution: Attacker dies (Disadvantage)", () => {
    game.rpsEnabled = true;
    const firePawn = game
      .getAlivePieces()
      .find((p) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.PAWN);
    const waterQueen = game
      .getAlivePieces()
      .find((p) => p.faction === FACTION.WATER && p.type === PIECE_TYPE.QUEEN);
    firePawn.pos = new Hex(0, 2);
    waterQueen.pos = new Hex(1, 1);
    game._rebuildOccupiedMap();
    game.handleCellClick(firePawn.pos);
    const result = game.handleCellClick(waterQueen.pos);
    expect(result.action).toBe("combat");
    expect(result.rpsResult).toBe("disadvantage");
    expect(firePawn.alive).toBe(false);
    expect(waterQueen.alive).toBe(true);
  });

  test("RPS disabled: combat always eliminates the defender (classic capture)", () => {
    // With RPS off, a capture is a normal chess capture regardless of faction:
    // the defender always dies, no advantage/disadvantage resolution.
    game.rpsEnabled = false;
    const firePiece = game
      .getAlivePieces()
      .find((p) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.QUEEN);
    const naturePiece = game
      .getAlivePieces()
      .find((p) => p.faction === FACTION.NATURE && p.type === PIECE_TYPE.QUEEN);
    firePiece.pos = new Hex(0, 0);
    naturePiece.pos = new Hex(0, 1);
    game._rebuildOccupiedMap();
    game.handleCellClick(firePiece.pos);
    const result = game.handleCellClick(naturePiece.pos);
    expect(result.action).toBe("combat");
    // No RPS resolution -> the attacker wins, defender is always captured.
    expect(naturePiece.alive).toBe(false);
    expect(firePiece.alive).toBe(true);
    expect(
      game.capturedPieces[FACTION.FIRE].some((p) => p.id === naturePiece.id),
    ).toBe(true);
  });

  test("nextTurn skips eliminated factions", () => {
    game.eliminatedFactions.add(FACTION.WATER);
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 5));
    game.pieces = [firePawn];
    game._rebuildOccupiedMap();
    game.handleCellClick(firePawn.pos);
    game.handleCellClick(new Hex(0, 4));
    expect(game.currentFaction).toBe(FACTION.NATURE);
  });

  test("nextTurn skips TWO eliminated factions and lands on the sole survivor", () => {
    // When Water AND Nature are eliminated, a Fire move must advance the turn
    // back onto Fire itself (the only remaining faction) without spinning
    // through the eliminated ones. This exercises the do/while skip loop in
    // _nextTurn for the 2-eliminated case — the historically infinite-loop
    // prone path.
    game.eliminatedFactions.add(FACTION.WATER);
    game.eliminatedFactions.add(FACTION.NATURE);
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 5));
    game.pieces = [firePawn];
    game._rebuildOccupiedMap();
    game.handleCellClick(firePawn.pos);
    const result = game.handleCellClick(new Hex(0, 4));
    expect(result.action).toBe("move");
    // Turn must wrap back to the sole survivor (Fire), never to a dead faction.
    expect(game.currentFaction).toBe(FACTION.FIRE);
    expect(game.eliminatedFactions.has(game.currentFaction)).toBe(false);
  });

  test("handleCellClick returns null in invalid state or game over", () => {
    game.state = GAME_STATE.GAME_OVER;
    expect(game.handleCellClick(new Hex(0, 0))).toBeNull();
    game.state = "invalid_state";
    expect(game.handleCellClick(new Hex(0, 0))).toBeNull();
  });

  test("handleCellClick is blocked after a draw (repetition / 50-move)", () => {
    // A draw ends the game just like game_over: no further clicks may move.
    const pawn = game.pieces.find(
      (p) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.PAWN,
    );
    game.state = GAME_STATE.DRAW_REPETITION;
    expect(game.handleCellClick(pawn.pos)).toBeNull();
    game.state = GAME_STATE.DRAW_50MOVE;
    expect(game.handleCellClick(pawn.pos)).toBeNull();
  });

  test("king elimination eliminates faction", () => {
    game.rpsEnabled = true;
    const fireQueen = game
      .getAlivePieces()
      .find((p) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.QUEEN);
    const natureKing = game
      .getAlivePieces()
      .find((p) => p.faction === FACTION.NATURE && p.type === PIECE_TYPE.KING);
    fireQueen.pos = new Hex(0, 0);
    natureKing.pos = new Hex(0, 1);
    game._rebuildOccupiedMap();
    game.handleCellClick(fireQueen.pos);
    const result = game.handleCellClick(natureKing.pos);
    expect(result.action).toBe("combat");
    expect(natureKing.alive).toBe(false);
    expect(game.eliminatedFactions.has(FACTION.NATURE)).toBe(true);
  });

  test("triggers callbacks and ends game when only one faction remains", () => {
    let eliminatedFaction = null;
    game.onGameOver = () => {};
    game.onElimination = (f) => {
      eliminatedFaction = f;
    };
    game.rpsEnabled = false;
    game.eliminatedFactions.add(FACTION.NATURE);
    const fireQueen = game
      .getAlivePieces()
      .find((p) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.QUEEN);
    const waterKing = game
      .getAlivePieces()
      .find((p) => p.faction === FACTION.WATER && p.type === PIECE_TYPE.KING);
    fireQueen.pos = new Hex(0, 0);
    waterKing.pos = new Hex(0, 1);
    game._rebuildOccupiedMap();
    game.handleCellClick(fireQueen.pos);
    const result = game.handleCellClick(waterKing.pos);
    expect(eliminatedFaction).toBe(FACTION.WATER);
    expect(game.state).toBe(GAME_STATE.GAME_OVER);
    expect(result.winner_faction).toBe(FACTION.FIRE);
  });

  test("winner_faction is null if all factions eliminated", () => {
    game.eliminatedFactions.add(FACTION.FIRE);
    game.eliminatedFactions.add(FACTION.WATER);
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 2));
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(1, 1),
    );
    game.pieces = [firePawn, natureKing];
    game._rebuildOccupiedMap();
    game.handleCellClick(firePawn.pos);
    const result = game.handleCellClick(natureKing.pos);
    expect(result.gameOver).toBe(true);
    expect(result.winner_faction).toBeNull();
  });

  test("onUpdate is safely skipped if not set", () => {
    game.onUpdate = null;
    const piece = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 5));
    game.pieces = [piece];
    game._rebuildOccupiedMap();
    game.handleCellClick(piece.pos);
    const result = game.handleCellClick(new Hex(0, 4));
    expect(result.action).toBe("move");
  });
});

// ─── Draw Rules Tests (each test creates its own fresh Game) ───

describe("Draw Rules: _positionHash includes current player", () => {
  test("hash differs for same position with different player to move", () => {
    const g = new Game();
    g.init(generateBoard());
    g.rpsEnabled = false;
    g.eliminatedFactions.clear();
    g.eliminatedFactions.add(FACTION.WATER);
    const fireQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 5));
    const natureQueen = new Piece(
      PIECE_TYPE.QUEEN,
      FACTION.NATURE,
      new Hex(-1, 2),
    );
    g.pieces = [fireQueen, natureQueen];
    g._rebuildOccupiedMap();
    g.eliminatedFactions.clear();
    g.eliminatedFactions.add(FACTION.WATER);
    const hash1 = g._positionHash();
    g.currentFactionIdx = 2;
    const hash2 = g._positionHash();
    expect(hash1).not.toBe(hash2);
  });

  test("hash same for same position AND same player to move", () => {
    const g1 = new Game();
    g1.init(generateBoard());
    g1.rpsEnabled = false;
    g1.eliminatedFactions.clear();
    g1.eliminatedFactions.add(FACTION.WATER);
    g1.pieces = [
      new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 5)),
      new Piece(PIECE_TYPE.QUEEN, FACTION.NATURE, new Hex(-1, 2)),
    ];
    g1._rebuildOccupiedMap();
    g1.eliminatedFactions.clear();
    g1.eliminatedFactions.add(FACTION.WATER);
    const hash1 = g1._positionHash();

    const fq2 = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 5));
    const nq2 = new Piece(PIECE_TYPE.QUEEN, FACTION.NATURE, new Hex(-1, 2));
    const g2 = new Game();
    g2.init(generateBoard());
    g2.rpsEnabled = false;
    g2.eliminatedFactions.add(FACTION.WATER);
    g2.pieces = [fq2, nq2];
    g2._rebuildOccupiedMap();
    g2.eliminatedFactions.add(FACTION.WATER);
    g2.currentFactionIdx = 0;
    const hash2 = g2._positionHash();
    expect(hash1).toBe(hash2);
  });
});

describe("Draw Rules: Threefold Repetition (_updateDrawState)", () => {
  test("detects threefold repetition via direct draw state calls", () => {
    const fireQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 5));
    const natureQueen = new Piece(
      PIECE_TYPE.QUEEN,
      FACTION.NATURE,
      new Hex(-1, 2),
    );
    const g = new Game();
    g.init(generateBoard());
    g.rpsEnabled = false;
    g.eliminatedFactions.clear();
    g.eliminatedFactions.add(FACTION.WATER);
    g.pieces = [fireQueen, natureQueen];
    g._rebuildOccupiedMap();
    g._positionHistory.clear();
    g._halfmoveClock = 0;

    g.currentFactionIdx = 0;
    let result = g._updateDrawState(false, false);
    expect(result).toBe(false);
    expect(g._positionHistory.size).toBe(1);

    g.currentFactionIdx = 2;
    const r2 = g._updateDrawState(false, false);
    expect(r2).toBe(false);
    expect(g._positionHistory.size).toBe(2);

    g.currentFactionIdx = 0;
    let r3 = g._updateDrawState(false, false);
    expect(r3).toBe(false);

    g.currentFactionIdx = 2;
    const r4 = g._updateDrawState(false, false);
    expect(r4).toBe(false);

    g.currentFactionIdx = 0;
    const r5 = g._updateDrawState(false, false);
    expect(r5).toBe(true);
    expect(g.state).toBe(GAME_STATE.DRAW_REPETITION);
  });
});

describe("Draw Rules: 50-Move Rule (_updateDrawState)", () => {
  test("resets halfmove clock on capture", () => {
    const g = new Game();
    g.init(generateBoard());
    g.rpsEnabled = false;
    g.eliminatedFactions.add(FACTION.WATER);
    g._halfmoveClock = 10;
    const game = g;
    game._updateDrawState(true, false);
    expect(game._halfmoveClock).toBe(0);
  });

  test("resets halfmove clock on pawn move", () => {
    const g = new Game();
    g.init(generateBoard());
    g.rpsEnabled = false;
    g.eliminatedFactions.add(FACTION.WATER);
    g._halfmoveClock = 10;
    const game = g;
    game._updateDrawState(false, true);
    expect(game._halfmoveClock).toBe(0);
  });

  test("detects 50-move rule at 100 half-moves", () => {
    const g = new Game();
    g.init(generateBoard());
    g.rpsEnabled = false;
    g.eliminatedFactions.add(FACTION.WATER);
    g._halfmoveClock = 99;
    g._positionHistory.clear();
    const game = g;
    const result = game._updateDrawState(false, false);
    expect(result).toBe(true);
    expect(g.state).toBe(GAME_STATE.DRAW_50MOVE);
  });

  test("capture resets clock before 50-move rule", () => {
    const g = new Game();
    g.init(generateBoard());
    g.rpsEnabled = false;
    g.eliminatedFactions.add(FACTION.WATER);
    g._halfmoveClock = 99;
    const game = g;
    game._updateDrawState(true, false);
    expect(game._halfmoveClock).toBe(0);
    expect(g.state).not.toBe(GAME_STATE.DRAW_50MOVE);
  });
});

describe("Draw Rules: Integration with handleCellClick", () => {
  test("handleCellClick returns draw=true on 50-move rule", () => {
    const g = new Game();
    g.init(generateBoard());
    g.rpsEnabled = false;
    g.eliminatedFactions.add(FACTION.WATER);
    g._halfmoveClock = 99;
    g._positionHistory.clear();

    const fireQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 5));
    const natureQueen = new Piece(
      PIECE_TYPE.QUEEN,
      FACTION.NATURE,
      new Hex(-1, 2),
    );
    const pieces = [fireQueen, natureQueen];
    g.pieces = pieces;
    g._rebuildOccupiedMap();
    g.eliminatedFactions.clear();
    g.eliminatedFactions.add(FACTION.WATER);
    g._halfmoveClock = 99;
    g._positionHistory.clear();

    g.handleCellClick(fireQueen.pos); // select
    const result = g.handleCellClick(new Hex(0, 4)); // 100th half-move
    expect(result).not.toBeNull();
    expect(result.draw).toBe(true);
    expect(g.state).toBe(GAME_STATE.DRAW_50MOVE);
  });
});

describe("Game Over: last faction standing", () => {
  test("a checkmating move eliminates the mated faction (checkmate, not stalemate)", () => {
    // A real checkmate must eliminate the mated faction, mirroring the
    // stalemate-elimination rule. Drive it through handleCellClick: Water rocks
    // the Fire king into a back-rank mate, then Fire is eliminated.
    const g = new Game();
    g.init(generateBoard());
    g.rpsEnabled = true;

    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const firePawn1 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, 0));
    const firePawn2 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, -1));
    const firePawn3 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, -1));
    const firePawn4 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(-1, 0));
    const firePawn5 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(-1, 1));
    const waterRook = new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 3));
    g.pieces = [
      fireKing,
      firePawn1,
      firePawn2,
      firePawn3,
      firePawn4,
      firePawn5,
      waterRook,
    ];
    g._rebuildOccupiedMap();
    // Water to move; rook delivers mate by sliding to (0,2).
    g.currentFactionIdx = 1; // WATER
    g.currentFaction = FACTION.WATER;
    g.state = GAME_STATE.SELECT_PIECE;

    g.handleCellClick(waterRook.pos); // select rook
    const r = g.handleCellClick(new Hex(0, 2)); // rook to (0,2) -> back-rank mate
    // The move is recorded as a checkmate of FIRE (set before elimination).
    expect(r.checkmate).toBe(FACTION.FIRE);
    // Checkmate (not stalemate) eliminates the mated faction.
    expect(g.eliminatedFactions.has(FACTION.FIRE)).toBe(true);
    // Fire pieces are killed off on elimination.
    expect(
      g.pieces.filter((p) => p.faction === FACTION.FIRE && p.alive).length,
    ).toBe(0);
  });

  test("a disadvantage combat (RPS loss) kills the attacker through handleCellClick", () => {
    // Fire loses to Water in RPS. A Fire attacker capturing a Water piece must
    // die itself and the Water defender must survive — the symmetric rule to
    // the advantage case, exercised through the real handleCellClick flow
    // (not just simulateMove).
    const g = new Game();
    g.init(generateBoard());
    g.rpsEnabled = true;
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 2));
    const waterPawn = new Piece(PIECE_TYPE.PAWN, FACTION.WATER, new Hex(0, 1));
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-5, 5));
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(5, -5));
    g.pieces = [firePawn, waterPawn, fireKing, waterKing];
    g._rebuildOccupiedMap();
    g.currentFactionIdx = 0; // FIRE to move
    g.currentFaction = FACTION.FIRE;
    g.state = GAME_STATE.SELECT_PIECE;

    g.handleCellClick(new Hex(0, 2)); // select fire pawn
    const r = g.handleCellClick(new Hex(0, 1)); // capture water pawn

    expect(r.action).toBe("combat");
    expect(r.rpsResult).toBe("disadvantage");
    expect(firePawn.alive).toBe(false); // attacker died
    expect(waterPawn.alive).toBe(true); // defender survived
    expect(g.eliminatedFactions.has(FACTION.FIRE)).toBe(false); // no king died
    // Turn advances to the next living faction (Water) despite the attacker dying.
    expect(g.currentFaction).toBe(FACTION.WATER);
  });
  test("eliminating the 2nd-last faction ends the game with a winner", () => {
    // When only one faction remains after an elimination, the game must end
    // and declare that faction the winner (game.ts:398-403). Drive it with a
    // real capture of the last enemy king; the other faction is pre-marked
    // eliminated so the post-capture checkmate cascade does not also remove it.
    const g = new Game();
    g.init(generateBoard());
    g.rpsEnabled = true;

    const fireQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 0));
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(0, 1),
    );
    g.pieces = [fireQueen, natureKing];
    g._rebuildOccupiedMap();
    // Pre-state: Water already eliminated, Nature still standing.
    g.eliminatedFactions.add(FACTION.WATER);
    g.currentFactionIdx = 0;
    g.currentFaction = FACTION.FIRE;
    g.state = GAME_STATE.SELECT_PIECE;

    // Fire queen captures Nature king -> only Fire remains -> GAME_OVER.
    g.handleCellClick(fireQueen.pos);
    const r = g.handleCellClick(natureKing.pos);
    expect(r.loser?.type).toBe(PIECE_TYPE.KING);
    expect(g.eliminatedFactions.has(FACTION.NATURE)).toBe(true);
    expect(g.eliminatedFactions.has(FACTION.WATER)).toBe(true);
    expect(g.state).toBe(GAME_STATE.GAME_OVER);
    expect(r.gameOver).toBe(true);
    expect(r.winner_faction).toBe(FACTION.FIRE);
  });

  test("with RPS disabled a disadvantaged attacker still wins (defender dies)", () => {
    // When rpsEnabled is false the engine treats every combat as 'advantage',
    // so the attacker always wins regardless of the RPS matchup. A Fire pawn
    // (which would LOSE to Water under RPS) must therefore capture the Water
    // pawn and survive when RPS is off — the exact opposite of the
    // rpsEnabled=true disadvantage case.
    const g = new Game();
    g.init(generateBoard());
    g.rpsEnabled = false; // RPS off -> all combats resolve as advantage

    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 2));
    const waterPawn = new Piece(PIECE_TYPE.PAWN, FACTION.WATER, new Hex(0, 1));
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-5, 5));
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(5, -5));
    g.pieces = [firePawn, waterPawn, fireKing, waterKing];
    g._rebuildOccupiedMap();
    g.currentFactionIdx = 0; // FIRE to move
    g.currentFaction = FACTION.FIRE;
    g.state = GAME_STATE.SELECT_PIECE;

    g.handleCellClick(new Hex(0, 2)); // select fire pawn
    const r = g.handleCellClick(new Hex(0, 1)); // capture water pawn

    expect(r.action).toBe("combat");
    // With RPS off there is no disadvantage branch -> attacker wins.
    expect(r.rpsResult).toBe("advantage");
    expect(firePawn.alive).toBe(true); // attacker survives
    expect(waterPawn.alive).toBe(false); // defender dies
    // The attacker moves onto the captured square.
    expect(firePawn.pos.equals(new Hex(0, 1))).toBe(true);
  });

  test("clicking a non-target cell deselects; clicking own piece reselects", () => {
    // Once a piece is selected (SELECT_TARGET), handleCellClick must only act
    // on valid move/attack squares. A click on a square that is neither a valid
    // move nor attack must CANCEL the selection (deselect) without moving,
    // while a click on another friendly piece must RESELECT it. This guards the
    // UI against accidental moves into empty/off-board cells.
    const g = new Game();
    g.init(generateBoard());
    g.rpsEnabled = true;

    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 2));
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-5, 5));
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(5, -5));
    g.pieces = [firePawn, fireKing, waterKing];
    g._rebuildOccupiedMap();
    g.currentFactionIdx = 0; // FIRE to move
    g.currentFaction = FACTION.FIRE;
    g.state = GAME_STATE.SELECT_PIECE;

    // Select the pawn.
    const sel = g.handleCellClick(new Hex(0, 2));
    expect(sel.action).toBe("select");
    expect(g.state).toBe(GAME_STATE.SELECT_TARGET);

    // Click a square that is NOT a valid move or attack (far away) -> deselect.
    const bad = g.handleCellClick(new Hex(5, -5)); // water king's square, unreachable
    expect(bad.action).toBe("deselect");
    expect(g.selectedPiece).toBeNull();
    expect(g.state).toBe(GAME_STATE.SELECT_PIECE);
    expect(firePawn.pos.equals(new Hex(0, 2))).toBe(true); // pawn did NOT move

    // Re-select the pawn, then click the friendly king -> reselect the king.
    g.handleCellClick(new Hex(0, 2));
    expect(g.selectedPiece?.id).toBe(firePawn.id);
    const re = g.handleCellClick(new Hex(-5, 5)); // own king
    expect(re.action).toBe("select"); // reselection of a new piece
    expect(g.selectedPiece?.id).toBe(fireKing.id); // king is now selected
    expect(g.state).toBe(GAME_STATE.SELECT_TARGET);
  });
});

describe("simulateMove/undoMove round-trip (AI search integrity)", () => {
  let game;
  beforeEach(() => {
    game = new Game();
    game.init(generateBoard());
    game.pieces = [];
    game._rebuildOccupiedMap();
    game.rpsEnabled = true;
  });

  test("disadvantage capture: attacker dies and undo fully restores it", () => {
    // Fire is at a disadvantage vs Water (Fire loses to Water in RPS). When a
    // Fire piece captures a Water piece under disadvantage, the ATTACKER dies.
    // simulateMove must (a) kill the attacker, (b) record it in
    // capturedPieces[defender.faction], and undoMove must reverse BOTH — no
    // stale captured entry left behind, since the AI relies on this exact
    // symmetry for a corruption-free search.
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 2));
    const waterPawn = new Piece(PIECE_TYPE.PAWN, FACTION.WATER, new Hex(0, 1));
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-5, 5));
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(5, -5));
    game.pieces = [firePawn, waterPawn, fireKing, waterKing];
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0; // FIRE
    game.currentFaction = FACTION.FIRE;

    const undo = game.simulateMove(firePawn, new Hex(0, 1));

    // Post-simulate: attacker dead, defender survives, captured by Water.
    expect(firePawn.alive).toBe(false);
    expect(waterPawn.alive).toBe(true);
    expect(undo.attackerDied).toBe(true);
    expect(undo.defenderWasKilled).toBe(false);
    expect(game.capturedPieces[FACTION.WATER].includes(firePawn)).toBe(true);

    game.undoMove(undo);

    // Post-undo: attacker revived on its original square, turn restored, and
    // the captured entry is gone (no leak that would corrupt later search).
    expect(firePawn.alive).toBe(true);
    expect(firePawn.pos.equals(new Hex(0, 2))).toBe(true);
    expect(game.currentFaction).toBe(FACTION.FIRE);
    expect(game.capturedPieces[FACTION.WATER].includes(firePawn)).toBe(false);
    expect(game.capturedPieces[FACTION.WATER].length).toBe(0);
  });

  test("advantage capture: defender dies and undo fully restores it", () => {
    // Fire beats Nature (advantage): the defender dies. Simulate + undo must
    // restore the defender to its square and remove it from the attacker's
    // captured list — the mirror of the disadvantage case.
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 2));
    const naturePawn = new Piece(
      PIECE_TYPE.PAWN,
      FACTION.NATURE,
      new Hex(0, 1),
    );
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-5, 5));
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(5, 5),
    );
    game.pieces = [firePawn, naturePawn, fireKing, natureKing];
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0; // FIRE
    game.currentFaction = FACTION.FIRE;

    const undo = game.simulateMove(firePawn, new Hex(0, 1));

    expect(naturePawn.alive).toBe(false); // defender dies
    expect(firePawn.alive).toBe(true); // attacker survives
    expect(undo.defenderWasKilled).toBe(true);
    expect(game.capturedPieces[FACTION.FIRE].includes(naturePawn)).toBe(true);

    game.undoMove(undo);

    expect(naturePawn.alive).toBe(true);
    expect(naturePawn.pos.equals(new Hex(0, 1))).toBe(true);
    expect(game.capturedPieces[FACTION.FIRE].includes(naturePawn)).toBe(false);
    expect(game.capturedPieces[FACTION.FIRE].length).toBe(0);
  });
});
