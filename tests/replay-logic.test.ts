/**
 * replay-logic.test.js - focused coverage for the TSPN replay/export
 * subsystem in js/replay.ts that the broader UI tests don't exercise:
 *  - serializeGame / parseTSPN / parseMoveText round-trip + edge cases
 *  - getResultString (game-over vs in-progress, winner mapping)
 *  - cloneGameState (independent deep copy)
 *  - ReplayController navigation bounds (next/previous/goTo/goToStart/End)
 *
 * Deterministic and fast (no AI, no DOM).
 */
import { expect, test, describe, beforeEach, vi } from "vitest";
import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import { Piece, PIECE_TYPE } from "../js/pieces.ts";
import { Hex } from "../js/hex.ts";
import { GAME_STATE } from "../js/game.ts";
import { GameResult } from "../js/types.ts";
import {
  serializeGame,
  parseTSPN,
  parseMoveText,
  formatMove,
  getResultString,
  cloneGameState,
  ReplayController,
  reconstructGameFromTSPN,
  downloadGame,
  copyGameToClipboard,
  loadGameFromString,
  loadGameFromFile,
  parseMoveToken,
  resolveSourcePiece,
  replayGame,
} from "../js/replay.ts";

// A real Game instance so ReplayController.precomputeStates() can call
// handleCellClick without throwing. Used with an EMPTY move history so the
// navigation bounds are deterministic (no state replay needed).
function makeEmptyGame() {
  const game = new Game();
  game.init(generateBoard());
  return game;
}

// Move-history entries in the SHAPE serializeGame/formatMove expect:
//   move.piece = { faction, type, ... } ; move.to = { q, r } ; move.action
function makeMoves(): GameResult[] {
  return [
    {
      piece: { faction: "fire", type: "pawn" } as GameResult["piece"],
      to: new Hex(1, 1),
      action: "move",
    },
    {
      piece: { faction: "water", type: "king" } as GameResult["piece"],
      to: new Hex(2, 2),
      action: "move",
    },
  ];
}

function makeGameLike(overrides = {}) {
  return {
    pieces: [
      {
        id: "p1",
        type: "pawn",
        faction: "fire",
        pos: { q: 0, r: 0 },
        alive: true,
      },
      {
        id: "p2",
        type: "king",
        faction: "water",
        pos: { q: 3, r: 3 },
        alive: true,
      },
    ],
    currentFaction: "fire",
    currentFactionIdx: 0,
    state: "playing",
    eliminatedFactions: new Set(),
    rpsEnabled: true,
    capturedPieces: { fire: [], water: [], nature: [] },
    moveHistory: makeMoves(),
    ...overrides,
  };
}

describe("serializeGame / parseTSPN round-trip", () => {
  test("serializeGame emits TSPN headers and move text", () => {
    const game = makeGameLike();
    const tspn = serializeGame(game);
    expect(tspn).toContain('[Event "Casual Game"]');
    expect(tspn).toContain('[RPS "on"]');
    expect(tspn).toContain('[Variant "TriSchach"]');
    expect(tspn).toContain("[Version");
    // The two moves should appear in the body (faction_pieceType_q,r)
    expect(tspn).toContain("fire_Pawn_1,1");
    expect(tspn).toContain("water_King_2,2");
  });

  test("parseTSPN recovers headers and moves", () => {
    const game = makeGameLike();
    const tspn = serializeGame(game);
    const parsed = parseTSPN(tspn);
    expect(parsed.headers.Event).toBe("Casual Game");
    expect(parsed.headers.RPS).toBe("on");
    expect(parsed.moves.length).toBe(2);
    expect(parsed.moves[0]!.faction).toBe("fire");
    expect(parsed.moves[1]!.faction).toBe("water");
  });

  test("parseTSPN handles a header-less / move-less string", () => {
    const parsed = parseTSPN("");
    expect(parsed.headers).toEqual({});
    expect(parsed.moves).toEqual([]);
  });

  // ─── Header-override contract (SerializeOptions index signature) ───
  // SerializeOptions documents "honors any override passed here" for PGN-style
  // headers, but serializeGame previously ignored every override and always
  // emitted its hardcoded defaults. These pin the documented behaviour.
  test("serializeGame honors a canonical header override (event)", () => {
    const game = makeGameLike();
    const tspn = serializeGame(game, { event: "World Cup" });
    expect(tspn).toContain('[Event "World Cup"]');
    expect(tspn).not.toContain('[Event "Casual Game"]');
  });

  test("serializeGame honors PascalCase player-name overrides", () => {
    const game = makeGameLike();
    const tspn = serializeGame(game, {
      Fire: "Alice",
      Water: "Bob",
      Nature: "Carol",
    });
    expect(tspn).toContain('[Fire "Alice"]');
    expect(tspn).toContain('[Water "Bob"]');
    expect(tspn).toContain('[Nature "Carol"]');
    // The hardcoded placeholder names must be gone.
    expect(tspn).not.toContain('[Fire "Player 1"]');
  });

  test("serializeGame override does not duplicate a header line", () => {
    const game = makeGameLike();
    const tspn = serializeGame(game, { Fire: "Alice" });
    const fireLines = tspn.split("\n").filter((l) => l.startsWith("[Fire "));
    expect(fireLines).toHaveLength(1);
  });

  test("ReplayController.exportTSPN applies caller headers end-to-end", () => {
    const game = makeEmptyGame();
    const ctrl = new ReplayController(game, []);
    const tspn = ctrl.exportTSPN({ Event: "My Event" });
    const parsed = parseTSPN(tspn);
    expect(parsed.headers.Event).toBe("My Event");
  });

  test("cloneGameState copies captured pieces for all three factions", () => {
    // Exercises the water/nature branches of the capturedPieces
    // serialization (replay.ts:623-624) that the fire-only move
    // fixtures skip.
    const game = makeGameLike({
      capturedPieces: {
        fire: [{ id: "np1", type: "pawn", faction: "nature" }],
        water: [{ id: "fp1", type: "rook", faction: "fire" }],
        nature: [{ id: "wp1", type: "bishop", faction: "water" }],
      },
    });
    const clone = cloneGameState(game);
    expect(clone.capturedPieces.fire).toEqual(["np1"]);
    expect(clone.capturedPieces.water).toEqual(["fp1"]);
    expect(clone.capturedPieces.nature).toEqual(["wp1"]);
  });

  test("parseMoveText parses the real faction_PieceType_q,r format", () => {
    const moves = parseMoveText("1. fire_Pawn_0,1 2. water_King_2,2");
    expect(moves.length).toBe(2);
    expect(moves[0]!.faction).toBe("fire");
    expect(moves[0]!.pieceName).toBe("pawn");
    expect(moves[1]!.faction).toBe("water");
  });

  test("parseMoveText returns [] for empty input", () => {
    expect(parseMoveText("")).toEqual([]);
    expect(parseMoveText("   ")).toEqual([]);
  });
});

describe("getResultString", () => {
  test("returns * while the game is in progress", () => {
    expect(getResultString(makeGameLike({ state: "playing" }))).toBe("*");
  });

  test("maps the winning faction once the game is over", () => {
    const game = makeGameLike({
      state: "game_over",
      moveHistory: [...makeMoves(), { winner_faction: "fire" }],
    });
    expect(getResultString(game)).toBe("1-0-0");
  });

  test("falls back to a draw string when no winner is recorded", () => {
    const game = makeGameLike({
      state: "game_over",
      moveHistory: [...makeMoves()],
    });
    expect(getResultString(game)).toBe("1/2-1/2-1/2");
  });
});

describe("formatMove annotations", () => {
  // Helper: build a minimal move entry in the shape serializeGame emits.
  const baseMove = {
    piece: { faction: "fire" as const, type: "pawn", id: "p1" },
    to: { q: 1, r: 1 },
    faction: "fire" as const,
    action: "move" as const,
  };

  test("emits the plain faction_pieceType_q,r notation for a quiet move", () => {
    expect(formatMove(baseMove, {} as never, 0)).toBe("fire_Pawn_1,1");
  });

  test("marks the RPS result on a combat move (advantage/disadvantage/neutral)", () => {
    const advantage = formatMove(
      { ...baseMove, action: "combat", rpsResult: "advantage" },
      {} as never,
      0,
    );
    expect(advantage).toContain("fire_Pawn_x_1,1 >");

    const disadvantage = formatMove(
      { ...baseMove, action: "combat", rpsResult: "disadvantage" },
      {} as never,
      0,
    );
    expect(disadvantage).toContain("fire_Pawn_x_1,1 <");

    const neutral = formatMove(
      { ...baseMove, action: "combat", rpsResult: "neutral" },
      {} as never,
      0,
    );
    expect(neutral).toContain("fire_Pawn_x_1,1 =");
  });

  test("appends =Q for promotion", () => {
    const promoted = formatMove(
      { ...baseMove, promotion: true },
      {} as never,
      0,
    );
    expect(promoted).toContain("=Q");
  });

  test("appends # for checkmate and + for a mere check", () => {
    const mate = formatMove({ ...baseMove, checkmate: true }, {} as never, 0);
    expect(mate.endsWith("#")).toBe(true);

    const check = formatMove({ ...baseMove, inCheck: true }, {} as never, 0);
    expect(check.endsWith("+")).toBe(true);
  });

  test("appends the [faction eliminated] annotation on elimination", () => {
    const elim = formatMove(
      { ...baseMove, elimination: "water" },
      {} as never,
      0,
    );
    expect(elim).toContain("[water eliminated]");
  });

  test("falls back to a promotion placeholder when no piece is present", () => {
    // No `piece`, but a `to` target and a top-level `faction` → reaches the
    // `${move.faction || "unknown"}_Promotion=Q` defensive branch.
    const noPiece = formatMove(
      { faction: "fire", action: "move", to: { q: 2, r: 2 } } as never,
      {} as never,
      0,
    );
    expect(noPiece).toBe("fire_Promotion=Q");
  });

  test("falls back to a promotion placeholder for promotion-only entries", () => {
    const promoOnly = formatMove(
      {
        faction: "water",
        action: "promotion",
        piece: { faction: "water", type: "pawn", id: "p2" },
      } as never,
      {} as never,
      0,
    );
    expect(promoOnly).toBe("water_Promotion=Q");
  });
});

describe("cloneGameState", () => {
  test("produces an independent copy of pieces and factions", () => {
    const game = makeGameLike();
    const clone = cloneGameState(game);
    expect(clone.pieces.length).toBe(2);
    // Mutating the clone must not affect the original
    clone.pieces[0]!.alive = false;
    clone.eliminatedFactions = ["water"];
    expect(game.pieces[0]!.alive).toBe(true);
    expect(Array.from(game.eliminatedFactions)).toEqual([]);
  });
});

describe("ReplayController navigation bounds", () => {
  let controller: ReplayController;
  beforeEach(() => {
    // Empty history -> canGoForward is false, getCurrentState returns the
    // single precomputed initial state (states[0]).
    controller = new ReplayController(makeEmptyGame(), []);
  });

  test("getTotalMoves reflects the move history length", () => {
    expect(controller.getTotalMoves()).toBe(0);
  });

  test("getCurrentMoveNumber starts at 0 (index -1)", () => {
    expect(controller.getCurrentMoveNumber()).toBe(0);
  });

  test("next() returns null when already at the end (empty history)", () => {
    expect(controller.next()).toBeNull();
  });

  test("previous() returns null at the start", () => {
    expect(controller.previous()).toBeNull();
  });

  test("goTo rejects out-of-range indices", () => {
    expect(controller.goTo(99)).toBeNull();
    expect(controller.goTo(-5)).toBeNull();
  });

  test("goToStart returns the initial state (not null)", () => {
    const state = controller.goToStart();
    expect(state).not.toBeNull();
    expect(controller.getCurrentMoveNumber()).toBe(0);
  });

  test("goToEnd on empty history lands on the initial state", () => {
    const state = controller.goToEnd();
    expect(state).not.toBeNull();
    expect(controller.getCurrentMoveNumber()).toBe(0);
  });
});

describe("ReplayController TSPN export", () => {
  let controller: ReplayController;
  beforeEach(() => {
    // Empty history avoids precomputeStates replay; exportTSPN serializes
    // the initial game state, which is what we want to assert here.
    controller = new ReplayController(makeEmptyGame(), []);
  });

  test("exportTSPN emits a parseable TSPN for the initial position", () => {
    const tspn = controller.exportTSPN();
    expect(typeof tspn).toBe("string");
    const parsed = parseTSPN(tspn);
    expect(parsed.headers.Variant).toBe("TriSchach");
  });

  test("exportTSPNFull marks the game over and is parseable", () => {
    const tspn = controller.exportTSPNFull();
    const parsed = parseTSPN(tspn);
    expect(parsed.headers.Variant).toBe("TriSchach");
    expect(parsed.headers.Result).toBeDefined();
  });
});

describe("downloadGame / copyGameToClipboard / loadGameFromString / loadGameFromFile", () => {
  let clickSpy: ReturnType<typeof vi.fn>;
  let writeTextSpy: ReturnType<typeof vi.fn>;
  let urlMock: {
    createObjectURL: ReturnType<typeof vi.fn>;
    revokeObjectURL: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    clickSpy = vi.fn();
    const mockAnchor = {
      click: clickSpy,
      set href(_v: string) {},
      set download(_v: string) {},
    };
    vi.spyOn(document, "createElement").mockReturnValue(
      mockAnchor as unknown as HTMLElement,
    );
    urlMock = {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    };
    (globalThis as unknown as { URL: typeof urlMock }).URL = urlMock;
    writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextSpy },
      configurable: true,
    });
  });

  test("downloadGame serializes and triggers a download anchor", () => {
    const game = makeEmptyGame();
    game.moveHistory = makeMoves();
    downloadGame(game, "test.tspn");
    expect(urlMock.createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(urlMock.revokeObjectURL).toHaveBeenCalled();
  });

  test("copyGameToClipboard writes the serialized TSPN", async () => {
    const game = makeEmptyGame();
    game.moveHistory = makeMoves();
    await copyGameToClipboard(game);
    expect(writeTextSpy).toHaveBeenCalledOnce();
    const written = writeTextSpy.mock.calls[0]![0];
    expect(written).toContain('[Variant "TriSchach"]');
  });

  test("loadGameFromString round-trips a serialized game", () => {
    const game = makeEmptyGame();
    game.moveHistory = makeMoves();
    const tspn = serializeGame(game);
    const parsed = loadGameFromString(tspn);
    expect(parsed.moves.length).toBe(2);
  });

  test("loadGameFromFile resolves parsed TSPN via FileReader", async () => {
    const game = makeEmptyGame();
    game.moveHistory = makeMoves();
    const tspn = serializeGame(game);

    const fakeReader = {
      readAsText: vi.fn(function (this: any, _file: unknown) {
        // Simulate async load
        queueMicrotask(() => this.onload({ target: { result: tspn } }));
      }),
    };
    vi.stubGlobal("FileReader", function () {
      return fakeReader;
    });

    const parsed = await loadGameFromFile({} as unknown as File);
    expect(parsed.moves.length).toBe(2);
    vi.unstubAllGlobals();
  });

  test("eliminated faction is preserved through serialize -> parse (real game)", () => {
    // Drive a REAL game to a state where one faction is eliminated, then
    // confirm the elimination marker is written into the TSPN AND correctly
    // round-trips through parseTSPN. This guards the parser against splitting
    // the trailing "[nature eliminated]" annotation into bogus tokens
    // (regression: the annotation used to be shredded into "[nature" /
    // "eliminated]"). Mock-based serialize tests don't exercise the real
    // elimination path through handleCellClick.
    const game = new Game();
    game.init(generateBoard());
    game.rpsEnabled = true;
    // Fire queen captures the Nature king (Fire beats Nature = advantage) ->
    // Nature is eliminated; Water alive so not game over.
    const fireQueen = new Piece(PIECE_TYPE.QUEEN, FACTION.FIRE, new Hex(0, 0));
    const natureKing = new Piece(
      PIECE_TYPE.KING,
      FACTION.NATURE,
      new Hex(0, 1),
    );
    const waterKing = new Piece(PIECE_TYPE.KING, FACTION.WATER, new Hex(-3, 3));
    game.pieces = [fireQueen, natureKing, waterKing];
    game._rebuildOccupiedMap();
    game.currentFactionIdx = 0;
    game.currentFaction = FACTION.FIRE;
    game.state = GAME_STATE.SELECT_PIECE;

    game.handleCellClick(new Hex(0, 0));
    game.handleCellClick(new Hex(0, 1));
    expect(game.eliminatedFactions.has(FACTION.NATURE)).toBe(true);

    const tspn = serializeGame(game);
    // The elimination must be encoded in the move notation.
    expect(tspn).toContain("[nature eliminated]");

    // Parse back: exactly ONE move, and it carries the elimination marker.
    const parsed = parseTSPN(tspn);
    expect(parsed.moves.length).toBe(1);
    expect(parsed.moves[0]!.elimination).toBe("nature");
  });

  test("serialize -> reconstruct round-trip replays a saved game (real game)", () => {
    // A TSPN file loaded via parseTSPN carries only faction/pieceName/target
    // (no source square). reconstructGameFromTSPN + ReplayController must still
    // replay it to the final position. Regression guard for the previously
    // broken replay path that required `move.piece` AND passed a non-Hex
    // {q,r} target straight into handleCellClick (which set piece.pos to a
    // plain object and crashed the post-move check detection).
    const game = new Game();
    game.init(generateBoard());
    game.rpsEnabled = true;
    // Play a real opening pawn move on the full starting board.
    const firePawn = game.pieces.find(
      (p) => p.faction === FACTION.FIRE && p.type === PIECE_TYPE.PAWN,
    );
    if (!firePawn) throw new Error("firePawn not found");
    const startKey = firePawn.pos.key;
    game.handleCellClick(firePawn.pos);
    const target = game.validMoves[0];
    if (!target) throw new Error("target not found");
    game.handleCellClick(target);
    expect(firePawn.pos.key).toBe(target.key);

    const tspn = serializeGame(game);
    const parsed = parseTSPN(tspn);
    const { controller } = reconstructGameFromTSPN(
      parsed,
      Game,
      generateBoard(),
    );
    controller.goToEnd();
    const finalState = controller.getCurrentState();

    // The reconstructed game replayed the move: the pawn left its start square
    // and now sits on the recorded target square. NOTE: cloneGameState returns
    // pos as a plain {q,r} object (no .key), so compare q/r explicitly.
    const replayedPawn = finalState.pieces.find((p) => p.id === firePawn.id);
    expect(replayedPawn).toBeDefined();
    expect(`${replayedPawn!.pos.q},${replayedPawn!.pos.r}`).toBe(
      `${target.q},${target.r}`,
    );
    // The start square is now empty (pawn moved away).
    const occupant = finalState.pieces.find(
      (p) => `${p.pos.q},${p.pos.r}` === startKey && p.alive,
    );
    expect(occupant?.id === firePawn.id).toBe(false);
  });
});

describe("formatMove / parseMoveToken: promotion piece type is preserved", () => {
  test("formatMove writes the chosen promotion piece (R/B/N/Q), not always Q", () => {
    const rookPromo = {
      action: "promotion" as const,
      piece: { faction: FACTION.FIRE },
      promotionType: "rook",
    };
    const bishopPromo = {
      action: "promotion" as const,
      piece: { faction: FACTION.WATER },
      promotionType: "bishop",
    };
    const knightPromo = {
      action: "promotion" as const,
      piece: { faction: FACTION.NATURE },
      promotionType: "knight",
    };
    expect(formatMove(rookPromo as never)).toBe("fire_Promotion=R");
    expect(formatMove(bishopPromo as never)).toBe("water_Promotion=B");
    expect(formatMove(knightPromo as never)).toBe("nature_Promotion=N");
  });

  test("formatMove falls back to Q when no promotionType is provided", () => {
    const noType = {
      action: "promotion" as const,
      piece: { faction: FACTION.FIRE },
    };
    expect(formatMove(noType as never)).toBe("fire_Promotion=Q");
  });

  test("parseMoveToken reads the promotion piece letter (R/B/N/Q)", () => {
    expect(parseMoveToken("fire_Promotion=R").promotionType).toBe("rook");
    expect(parseMoveToken("water_Promotion=B").promotionType).toBe("bishop");
    expect(parseMoveToken("nature_Promotion=N").promotionType).toBe("knight");
    expect(parseMoveToken("fire_Promotion=Q").promotionType).toBe("queen");
  });

  test("parseMoveToken reads promotion letter in a full move token", () => {
    const m = parseMoveToken("fire_Pawn_0,0=R");
    expect(m.promotion).toBe(true);
    expect(m.promotionType).toBe("rook");
    expect(m.target).toEqual({ q: 0, r: 0 });
  });

  test("completePromotion records promotionType in move history", () => {
    const game = new Game();
    game.init(generateBoard());
    const pawn = new Piece(PIECE_TYPE.PAWN, FACTION.FIRE, new Hex(0, 0));
    game.pieces = [pawn];
    game._rebuildOccupiedMap();
    game.pendingPromotion = pawn;
    game.state = GAME_STATE.PROMOTION;

    game.completePromotion(PIECE_TYPE.ROOK);
    const last = game.moveHistory[game.moveHistory.length - 1]!;
    expect(last.action).toBe("promotion");
    expect(last.promotionType).toBe("rook");
    expect(pawn.type).toBe(PIECE_TYPE.ROOK);
  });

  test("promotion round-trips through TSPN export + parse (R/B/N/Q)", () => {
    for (const [letter, type] of [
      ["R", "rook"],
      ["B", "bishop"],
      ["N", "knight"],
      ["Q", "queen"],
    ] as const) {
      const parsed = parseMoveToken(`fire_Promotion=${letter}`);
      expect(parsed.promotionType).toBe(type);
      // The writer must emit the same single letter back.
      const written = formatMove({
        action: "promotion",
        piece: { faction: FACTION.FIRE },
        promotionType: type,
      } as never);
      expect(written).toBe(`fire_Promotion=${letter}`);
    }
  });
});

// ─── Branch-coverage hardening: resolveSourcePiece / replayGame / cloneGameState ───
// These target real behavioural invariants of the replay reconstruction path
// (source-square resolution from TSPN, promotion replay, snapshot fallbacks)
// that the existing round-trip tests don't exercise. Not coverage padding —
// each asserts a specific contract of how a saved game is re-materialised.
describe("resolveSourcePiece (TSPN source-square resolution)", () => {
  test("returns the in-memory piece as-is when move.piece has a pos", () => {
    const piece = { faction: FACTION.FIRE, type: "pawn", pos: new Hex(1, 1) };
    const resolved = resolveSourcePiece(
      {} as never,
      {
        piece,
      } as never,
    );
    expect(resolved).toBe(piece);
  });

  test("returns null when target/faction/pieceName are missing", () => {
    expect(resolveSourcePiece({ pieces: [] } as never, {} as never)).toBeNull();
  });

  test("falls back to first candidate when game lacks getLegalMoves", () => {
    const p = { faction: FACTION.FIRE, type: "pawn", alive: true };
    const game = { pieces: [p] };
    const resolved = resolveSourcePiece(
      game as never,
      {
        faction: FACTION.FIRE,
        pieceName: "Pawn",
        target: { q: 5, r: 5 },
      } as never,
    );
    expect(resolved).toBe(p);
  });

  test("uses getLegalMoves to pick the candidate whose moves include target", () => {
    const p1 = {
      faction: FACTION.FIRE,
      type: "rook",
      alive: true,
      id: "r1",
    };
    const p2 = {
      faction: FACTION.FIRE,
      type: "rook",
      alive: true,
      id: "r2",
    };
    const game = {
      getAlivePieces: () => [p1, p2],
      getLegalMoves: (p: { id: string }) =>
        p.id === "r2"
          ? { moves: [{ q: 3, r: 4 }], attacks: [] }
          : { moves: [{ q: 9, r: 9 }], attacks: [] },
    };
    const resolved = resolveSourcePiece(
      game as never,
      {
        faction: FACTION.FIRE,
        pieceName: "Rook",
        target: { q: 3, r: 4 },
      } as never,
    );
    expect(resolved).toBe(p2);
  });

  test("returns first candidate when no legal move matches the target", () => {
    const p1 = { faction: FACTION.FIRE, type: "rook", alive: true, id: "r1" };
    const game = {
      getAlivePieces: () => [p1],
      getLegalMoves: () => ({ moves: [], attacks: [] }),
    };
    const resolved = resolveSourcePiece(
      game as never,
      {
        faction: FACTION.FIRE,
        pieceName: "Rook",
        target: { q: 3, r: 4 },
      } as never,
    );
    expect(resolved).toBe(p1);
  });
});

describe("replayGame generator", () => {
  test("yields an initial pre-move snapshot with index -1 and null move", () => {
    const game = makeEmptyGame();
    const gen = replayGame(game, []);
    const first = gen.next().value;
    expect(first.index).toBe(-1);
    expect(first.move).toBeNull();
    expect(Array.isArray(first.game.pieces)).toBe(true);
    // No moves → generator is exhausted after the initial snapshot.
    expect(gen.next().done).toBe(true);
  });

  test("skips null/undefined move-history entries without throwing", () => {
    const game = makeEmptyGame();
    const steps = [...replayGame(game, [null as never, undefined as never])];
    // Only the initial snapshot is yielded; the two empty moves are skipped.
    expect(steps).toHaveLength(1);
    expect(steps[0]!.index).toBe(-1);
  });
});

describe("cloneGameState snapshot fallbacks", () => {
  test("applies safe defaults for a minimal game object", () => {
    const snap = cloneGameState({ pieces: [] } as never);
    expect(snap.pieces).toEqual([]);
    expect(snap.currentFaction).toBe("");
    expect(snap.currentFactionIdx).toBe(0);
    expect(snap.state).toBe("");
    expect(snap.eliminatedFactions).toEqual([]);
    expect(snap.capturedPieces).toEqual({ fire: [], water: [], nature: [] });
  });

  test("normalises captured pieces from both object and string forms to ids", () => {
    const snap = cloneGameState({
      pieces: [],
      capturedPieces: {
        fire: [{ id: "f1" } as never],
        water: ["w-string" as never],
        nature: [{ id: "n1" } as never, "n-string" as never],
      },
    } as never);
    expect(snap.capturedPieces.fire).toEqual(["f1"]);
    expect(snap.capturedPieces.water).toEqual(["w-string"]);
    expect(snap.capturedPieces.nature).toEqual(["n1", "n-string"]);
  });

  test("produces a deep-independent pieces array (mutation does not leak)", () => {
    const src = {
      pieces: [
        {
          id: "p1",
          type: "pawn",
          faction: FACTION.FIRE,
          pos: { q: 1, r: 2 },
          alive: true,
        },
      ],
    };
    const snap = cloneGameState(src as never);
    snap.pieces[0]!.pos.q = 99;
    expect((src.pieces[0]!.pos as { q: number }).q).toBe(1);
  });
});
