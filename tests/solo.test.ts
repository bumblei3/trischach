import { describe, expect, test } from "vitest";
import { calculateBestMove, deserializeGame, setAIDepth } from "../js/ai.ts";
import { FACTION, generateBoard } from "../js/board.ts";
import { Game } from "../js/game.ts";
import { isSoloAiTurn, parseHumanFaction } from "../js/solo.ts";

describe("parseHumanFaction", () => {
  test("accepts the three factions", () => {
    expect(parseHumanFaction("fire")).toBe("fire");
    expect(parseHumanFaction("water")).toBe("water");
    expect(parseHumanFaction("nature")).toBe("nature");
  });

  test("treats empty and unknown values as hotseat", () => {
    expect(parseHumanFaction("")).toBeNull();
    expect(parseHumanFaction(null)).toBeNull();
    expect(parseHumanFaction(undefined)).toBeNull();
    expect(parseHumanFaction("hotseat")).toBeNull();
  });
});

describe("isSoloAiTurn", () => {
  const base = {
    humanFaction: "water" as const,
    currentFaction: "fire" as const,
    autoBattle: false,
    gameOver: false,
    blocked: false,
    inFlight: false,
  };

  test("the engine moves when it is not the human faction", () => {
    expect(isSoloAiTurn(base)).toBe(true);
  });

  test("the human plays their own turn", () => {
    expect(isSoloAiTurn({ ...base, currentFaction: "water" })).toBe(false);
  });

  test("hotseat never asks the engine", () => {
    expect(isSoloAiTurn({ ...base, humanFaction: null })).toBe(false);
  });

  test("auto-battle, a finished game, an overlay, and an in-flight search stay quiet", () => {
    expect(isSoloAiTurn({ ...base, autoBattle: true })).toBe(false);
    expect(isSoloAiTurn({ ...base, gameOver: true })).toBe(false);
    expect(isSoloAiTurn({ ...base, blocked: true })).toBe(false);
    expect(isSoloAiTurn({ ...base, inFlight: true })).toBe(false);
  });
});

describe("worker game state", () => {
  test("calculateBestMove on a deserialized opening returns a move", () => {
    setAIDepth(1);
    const game = new Game();
    game.init(generateBoard());
    const ghost = deserializeGame({
      pieces: game.getAlivePieces().map((p) => ({
        id: p.id,
        type: p.type,
        faction: p.faction,
        pos: { q: p.pos.q, r: p.pos.r },
        symbol: p.symbol,
        alive: p.alive,
        hasMoved: p.hasMoved,
      })),
      currentFactionIdx: game.currentFactionIdx,
      currentFaction: game.currentFaction,
      state: game.state,
      eliminatedFactions: [],
      rpsEnabled: game.rpsEnabled,
      capturedPieces: { fire: [], water: [], nature: [] },
      _halfmoveClock: 0,
    });
    expect(typeof ghost.getLegalMoves).toBe("function");
    const move = calculateBestMove(ghost, FACTION.FIRE);
    expect(move).not.toBeNull();
    expect(move?.piece.faction).toBe(FACTION.FIRE);
  });
});
