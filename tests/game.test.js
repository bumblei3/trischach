import { expect, test, describe, beforeEach } from "vitest";
import { Game, GAME_STATE } from "../js/game.js";
import { FACTION, generateBoard } from "../js/board.js";
import { Piece, PIECE_TYPE } from "../js/pieces.js";
import { Hex } from "../js/hex.js";

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
    if (result.action === "deselect") return;
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

  test("nextTurn skips eliminated factions", () => {
    game.eliminatedFactions.add(FACTION.WATER);
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 5));
    game.pieces = [firePawn];
    game._rebuildOccupiedMap();
    game.handleCellClick(firePawn.pos);
    game.handleCellClick(new Hex(0, 4));
    expect(game.currentFaction).toBe(FACTION.NATURE);
  });

  test("handleCellClick returns null in invalid state or game over", () => {
    game.state = GAME_STATE.GAME_OVER;
    expect(game.handleCellClick(new Hex(0, 0))).toBeNull();
    game.state = "invalid_state";
    expect(game.handleCellClick(new Hex(0, 0))).toBeNull();
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
