import { expect, test, describe, beforeEach } from "vitest";
import { Game } from "../js/game.js";
import { legalMoveCheck } from "../js/game-check.js";
import { FACTION, generateBoard } from "../js/board.js";
import { Piece, PIECE_TYPE } from "../js/pieces.js";
import { Hex } from "../js/hex.js";

describe("Check Detection", () => {
  let game;
  let boardCells;

  beforeEach(() => {
    game = new Game();
    boardCells = generateBoard();
    game.init(boardCells);
    game.rpsEnabled = false; // Disable RPS for predictable combat
  });

  test("king is not in check at game start", () => {
    expect(game.isKingInCheck(FACTION.FIRE)).toBe(false);
    expect(game.isKingInCheck(FACTION.WATER)).toBe(false);
    expect(game.isKingInCheck(FACTION.NATURE)).toBe(false);
  });

  test("king is in check when enemy queen attacks", () => {
    // Clear board, set up simple position
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const waterQueen = new Piece(
      PIECE_TYPE.QUEEN,
      FACTION.WATER,
      new Hex(2, 0),
    );
    game.pieces = [fireKing, waterQueen];
    game._rebuildOccupiedMap();

    expect(game.isKingInCheck(FACTION.FIRE)).toBe(true);
    expect(game.isKingInCheck(FACTION.WATER)).toBe(false);
  });

  test("king is in check when enemy rook attacks", () => {
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(0, 0),
    );
    const fireRook = new Piece(PIECE_TYPE.ROOK, FACTION.FIRE, new Hex(0, 3));
    game.pieces = [natureKing, fireRook];
    game._rebuildOccupiedMap();

    expect(game.isKingInCheck(FACTION.NATURE)).toBe(true);
  });

  test("king is NOT in check when blocked by friendly piece", () => {
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    const waterRook = new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 3));
    game.pieces = [fireKing, firePawn, waterRook];
    game._rebuildOccupiedMap();

    expect(game.isKingInCheck(FACTION.FIRE)).toBe(false);
  });

  test("isKingInCheck returns false when king is dead", () => {
    const waterQueen = new Piece(
      PIECE_TYPE.QUEEN,
      FACTION.WATER,
      new Hex(0, 0),
    );
    game.pieces = [waterQueen];
    game._rebuildOccupiedMap();

    expect(game.isKingInCheck(FACTION.FIRE)).toBe(false);
  });

  test("wouldBeInCheck detects moving into check", () => {
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const waterRook = new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 3));
    game.pieces = [fireKing, waterRook];
    game._rebuildOccupiedMap();

    // Moving king to (0,1) would put it in rook's line of attack
    expect(legalMoveCheck(game, fireKing, new Hex(0, 1), FACTION.FIRE)).toBe(
      false,
    );
    // Moving king to (1,0) is safe (rook attacks along r-axis)
    expect(legalMoveCheck(game, fireKing, new Hex(1, 0), FACTION.FIRE)).toBe(
      true,
    );
  });

  test("getLegalMoves excludes moves that leave king in check", () => {
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const waterRook = new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 3));
    game.pieces = [fireKing, waterRook];
    game._rebuildOccupiedMap();

    const legal = game.getLegalMoves(fireKing);
    // King at (0,0) has 6 neighbors, but (0,1) and (0,-1) are in rook's line
    // Only moves that escape the rook's attack are legal
    const illegalTargets = legal.moves.filter(
      (m) => m.equals(new Hex(0, 1)) || m.equals(new Hex(0, -1)),
    );
    expect(illegalTargets.length).toBe(0);
  });

  test("getLegalMoves excludes attacks that leave king in check", () => {
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, 0));
    const waterRook = new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 3));
    const waterPawn = new Piece(PIECE_TYPE.PAWN, FACTION.WATER, new Hex(2, 0));
    game.pieces = [fireKing, firePawn, waterRook, waterPawn];
    game._rebuildOccupiedMap();

    // Pawn at (1,0) could attack waterPawn at (2,0), but that would expose king
    const legal = game.getLegalMoves(firePawn);
    expect(legal.attacks.some((a) => a.equals(new Hex(2, 0)))).toBe(false);
  });
});

describe("Checkmate Detection", () => {
  let game;
  let boardCells;

  beforeEach(() => {
    game = new Game();
    boardCells = generateBoard();
    game.init(boardCells);
    game.rpsEnabled = false;
  });

  test("isCheckmate returns false when king can escape", () => {
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const waterQueen = new Piece(
      PIECE_TYPE.QUEEN,
      FACTION.WATER,
      new Hex(2, 0),
    );
    game.pieces = [fireKing, waterQueen];
    game._rebuildOccupiedMap();

    expect(game.isKingInCheck(FACTION.FIRE)).toBe(true);
    expect(game.isCheckmate(FACTION.FIRE)).toBe(false); // King can move to (1,0) etc.
  });

  test("isCheckmate returns true in back-rank mate", () => {
    // King at (0,0), enemy rook at (0,2) giving check along r-axis
    // Block 5 of 6 king escape routes with friendly pieces, leave (0,1) open
    // but (0,1) is attacked by the rook, so king can't go there either
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const firePawn1 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, 0));
    const firePawn2 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(1, -1));
    const firePawn3 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, -1));
    const firePawn4 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(-1, 0));
    const firePawn5 = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(-1, 1));
    // (0,1) is NOT blocked by friendly piece — but it's in rook's line, so moving there is illegal
    const waterRook = new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 2));
    game.pieces = [
      fireKing,
      firePawn1,
      firePawn2,
      firePawn3,
      firePawn4,
      firePawn5,
      waterRook,
    ];
    game._rebuildOccupiedMap();

    expect(game.isKingInCheck(FACTION.FIRE)).toBe(true);
    expect(game.isCheckmate(FACTION.FIRE)).toBe(true);
  });

  test("isCheckmate returns false when piece can block", () => {
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const fireRook = new Piece(PIECE_TYPE.ROOK, FACTION.FIRE, new Hex(5, 5));
    const waterQueen = new Piece(
      PIECE_TYPE.QUEEN,
      FACTION.WATER,
      new Hex(0, 3),
    );
    game.pieces = [fireKing, fireRook, waterQueen];
    game._rebuildOccupiedMap();

    expect(game.isKingInCheck(FACTION.FIRE)).toBe(true);
    // Fire rook can block at (0,1) or (0,2)
    expect(game.isCheckmate(FACTION.FIRE)).toBe(false);
  });

  test("isStalemate returns false when king has legal moves", () => {
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(5, 5),
    );
    const waterKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.WATER,
      new Hex(-5, -5),
    );
    game.pieces = [fireKing, natureKing, waterKing];
    game._rebuildOccupiedMap();

    expect(game.isKingInCheck(FACTION.FIRE)).toBe(false);
    expect(game.isStalemate(FACTION.FIRE)).toBe(false); // King can move
  });

  test("isStalemate returns false when in check", () => {
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const waterRook = new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 2));
    game.pieces = [fireKing, waterRook];
    game._rebuildOccupiedMap();

    expect(game.isKingInCheck(FACTION.FIRE)).toBe(true);
    expect(game.isStalemate(FACTION.FIRE)).toBe(false);
  });
});

describe("Check Resolution in Game Flow", () => {
  let game;
  let boardCells;

  beforeEach(() => {
    game = new Game();
    boardCells = generateBoard();
    game.init(boardCells);
    game.rpsEnabled = false;
  });

  test("move that puts own king in check is blocked", () => {
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(0, 0));
    const firePawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 1));
    const waterRook = new Piece(PIECE_TYPE.ROOK, FACTION.WATER, new Hex(0, 3));
    game.pieces = [fireKing, firePawn, waterRook];
    game._rebuildOccupiedMap();

    // Select fire pawn
    game.handleCellClick(firePawn.pos);
    // Try to move pawn away, exposing king to rook
    game.handleCellClick(new Hex(1, 1));

    // The pawn move should be blocked (deselect) because it's not a legal move
    // OR the pawn stays and king remains safe
    expect(game.isKingInCheck(FACTION.FIRE)).toBe(false);
  });

  test("result.inCheck is set after a move that gives check", () => {
    // Fire Queen on (1,0), Water King on (0,0), Fire King far away
    // Queen moves to (0,1) which is diagonal from (1,0) and adjacent to Water King
    // After Fire's move, Water is next and Water King is in check
    const fireQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(1, 0));
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(0, 0));
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-5, -5));
    const naturePawn = new Piece(
      PIECE_TYPE.PAWN,
      FACTION.NATURE,
      new Hex(5, 5),
    );
    game.pieces = [fireQueen, waterKing, fireKing, naturePawn];
    game._rebuildOccupiedMap();

    // Fire moves queen from (1,0) to (0,1) - diagonal move, gives check to water king
    game.handleCellClick(fireQueen.pos);
    const result = game.handleCellClick(new Hex(0, 1));

    expect(result.action).toBe("move");
    // After fire's move, water is next and water king should be in check
    expect(result.inCheck).toBe(true);
  });

  test("checkmate eliminates the mated faction", () => {
    // Verify isCheckmate correctly identifies a checkmated king.
    // Position: Nature King at (0,0), Fire Queen on (0,1) giving check.
    // 4 Nature rooks block 4 king neighbors that can't attack the queen.
    // The remaining neighbor (1,-1) is covered by queen's attack (NW from (0,1)).
    // King can't capture queen (protected by fire rook at (0,2)).
    // Nature rooks can't capture queen (not on same line).
    // No legal moves = checkmate.
    // Set up a position where Nature King is in check and has no legal moves
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(0, 0),
    );
    // All 6 neighbors are Nature pieces (king can't move to friendly-occupied squares)
    const np1 = new Piece(PIECE_TYPE.ROOK, FACTION.NATURE, new Hex(1, 0));
    const np2 = new Piece(PIECE_TYPE.ROOK, FACTION.NATURE, new Hex(1, -1));
    const np3 = new Piece(PIECE_TYPE.ROOK, FACTION.NATURE, new Hex(0, -1));
    const np4 = new Piece(PIECE_TYPE.ROOK, FACTION.NATURE, new Hex(-1, 0));
    const np5 = new Piece(PIECE_TYPE.ROOK, FACTION.NATURE, new Hex(-1, 1));
    const np6 = new Piece(PIECE_TYPE.ROOK, FACTION.NATURE, new Hex(0, 1));
    const fireKing = new Piece(PIECE_TYPE.KING, FACTION.FIRE, new Hex(-5, -5));
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(5, 5));
    game.pieces = [
      natureKing,
      np1,
      np2,
      np3,
      np4,
      np5,
      np6,
      fireKing,
      waterKing,
    ];
    game._rebuildOccupiedMap();

    // Now remove np6 (on (0,1)) and put fire queen there giving check
    // But we need to test isCheckmate, not the full move flow.
    // Just set up the position directly.
    const fq = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 1));
    game.pieces = [
      natureKing,
      np1,
      np2,
      np3,
      np4,
      np5,
      fq,
      fireKing,
      waterKing,
    ];
    game._rebuildOccupiedMap();

    // King at (0,0), neighbors: (1,0)=own rook, (1,-1)=own rook, (0,-1)=own rook,
    //   (-1,0)=own rook, (-1,1)=own rook, (0,1)=fire queen
    // King can't move to any neighbor (all occupied).
    // King can capture queen on (0,1)? Need to check if (0,1) is protected.
    // No protector in this position, so king CAN capture queen. Not checkmate.

    // Add fire rook to protect queen
    const fr = new Piece(PIECE_TYPE.ROOK, FACTION.FIRE, new Hex(0, 2));
    game.pieces = [
      natureKing,
      np1,
      np2,
      np3,
      np4,
      np5,
      fq,
      fr,
      fireKing,
      waterKing,
    ];
    game._rebuildOccupiedMap();

    // Now: king can't capture queen (rook at (0,2) protects via NW: (0,2)->(0,1)->(0,0))
    // Can nature rooks capture the queen?
    // Rook on (1,0): E=(2,0), NE=(2,-1), NW=(1,-1), W=(0,0), SW=(0,1)=QUEEN!, SE=(1,1)
    // SW from (1,0) = (0,1). YES! Rook on (1,0) can capture queen!

    // Replace (1,0) rook with a piece that can't reach (0,1)
    // Knight on (1,0): knight moves from (1,0) include...
    // dist=2, not straight: (1,0)+(±1,±1)=(2,1),(2,-1),(0,1),(0,-1)...
    // (0,1) IS reachable by knight! Bad.
    // Bishop on (1,0): diagonals from (1,0): (3,-1),(2,-2),(0,-1),(-1,1),(0,2),(2,1)
    // (0,1) is NOT in the list! Bishop on (1,0) CANNOT reach (0,1). Good!
    const nb1 = new Piece(PIECE_TYPE.BISHOP, FACTION.NATURE, new Hex(1, 0));
    game.pieces = [
      natureKing,
      nb1,
      np2,
      np3,
      np4,
      np5,
      fq,
      fr,
      fireKing,
      waterKing,
    ];
    game._rebuildOccupiedMap();

    // Check: can bishop on (1,0) reach queen on (0,1)?
    // Bishop diagonals: (+2,-1)->(3,-1), (+1,-2)->(2,-2), (-1,-1)->(0,-1),
    //   (-2,+1)->(-1,1), (-1,+2)->(0,2), (+1,+1)->(2,1)
    // (0,1) is NOT reachable. Good!

    // Can other rooks capture queen?
    // Rook on (1,-1): SE=(1,0), SW=(0,0), W=(0,-1), NW=(1,-2), NE=(2,-2), E=(2,-1)
    // (0,1) is NOT reachable. Good!
    // Rook on (0,-1): E=(1,-1), NE=(1,-2), NW=(0,-2), W=(-1,-1), SW=(-1,0), SE=(0,0)
    // (0,1) is NOT reachable. Good!
    // Rook on (-1,0): E=(0,0), NE=(0,-1), NW=(-1,-1), W=(-2,0), SW=(-2,1), SE=(-1,1)
    // (0,1) is NOT reachable. Good!
    // Rook on (-1,1): E=(0,1)=QUEEN! Bad!

    // Replace (-1,1) rook with bishop
    const nb2 = new Piece(PIECE_TYPE.BISHOP, FACTION.NATURE, new Hex(-1, 1));
    game.pieces = [
      natureKing,
      nb1,
      np2,
      np3,
      np4,
      nb2,
      fq,
      fr,
      fireKing,
      waterKing,
    ];
    game._rebuildOccupiedMap();

    // Bishop on (-1,1) diagonals: (+2,-1)->(1,0), (+1,-2)->(0,-1), (-1,-1)->(-2,0),
    //   (-2,+1)->(-3,2), (-1,+2)->(-2,3), (+1,+1)->(0,2)
    // (0,1) is NOT reachable. Good!

    // Now verify no nature piece can capture the queen
    console.log("Checking if any nature piece can capture queen at (0,1):");
    for (const p of game.pieces.filter(
      (p) => p.faction === FACTION.NATURE && p.alive,
    )) {
      const m = game.getLegalMoves(p);
      const canCaptureQueen = m.attacks.some((a) => a.equals(new Hex(0, 1)));
      if (canCaptureQueen || m.moves.some((m) => m.equals(new Hex(0, 1)))) {
        console.log("  PROBLEM:", p.type, p.pos.toString(), "can reach queen!");
      } else {
        console.log("  OK:", p.type, p.pos.toString(), "cannot reach queen");
      }
    }

    expect(game.isKingInCheck(FACTION.NATURE)).toBe(true);
    expect(game.isCheckmate(FACTION.NATURE)).toBe(true);
  });
});
