/**
 * main.ts must count draw games in the statistics dashboard.
 *
 * Game.onDraw fires on threefold repetition / 50-move (js/game.ts), and
 * recordGameResult counts `winner: null` as a draw (js/game-stats.ts). But
 * main.ts only wires `game.onGameOver` — a drawn game never reaches
 * recordGameResult, so `stats.draws` stays 0 forever and `totalGames` is
 * short by every draw. The dashboard shows a Remis row; it can never move.
 */
import { describe, test, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Game, GAME_STATE } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import { Hex } from "../js/hex.ts";
import { PIECE_TYPE, Piece } from "../js/pieces.ts";
import {
  GAME_STATS_KEY,
  loadGameStats,
  recordGameResult,
} from "../js/game-stats.ts";

beforeEach(() => {
  localStorage.removeItem(GAME_STATS_KEY);
});

describe("draw games reach the statistics", () => {
  test("Game reaches DRAW_REPETITION and fires onDraw('repetition')", () => {
    const game = new Game();
    game.init(generateBoard());
    game.rpsEnabled = false;
    game.eliminatedFactions.add(FACTION.NATURE);

    const fireKnight = new Piece(
      PIECE_TYPE.KNIGHT,
      FACTION.FIRE,
      new Hex(0, 0),
    );
    const waterKnight = new Piece(
      PIECE_TYPE.KNIGHT,
      FACTION.WATER,
      new Hex(0, 3),
    );
    game.pieces = [fireKnight, waterKnight];
    game._rebuildOccupiedMap();
    game.state = GAME_STATE.SELECT_PIECE;

    const onDraw = vi.fn();
    game.onDraw = onDraw;

    const play = (from: Hex, to: Hex) => {
      game.handleCellClick(from);
      return game.handleCellClick(to);
    };
    for (let i = 0; i < 3; i++) {
      play(new Hex(0, 0), new Hex(-2, 1));
      play(new Hex(0, 3), new Hex(-1, 2));
      play(new Hex(-2, 1), new Hex(0, 0));
      play(new Hex(-1, 2), new Hex(0, 3));
    }

    expect(game.state).toBe(GAME_STATE.DRAW_REPETITION);
    expect(onDraw).toHaveBeenCalledWith("repetition");
  });

  test("recordGameResult counts a draw when winner is null", () => {
    recordGameResult({ winner: null, mode: "manual", moves: 90 });
    const s = loadGameStats();
    expect(s.totalGames).toBe(1);
    expect(s.draws).toBe(1);
    expect(s.manualGames).toBe(1);
    expect(Object.values(s.manualWins).every((v) => v === 0)).toBe(true);
  });

  test("main.ts wires game.onDraw so a drawn game is recorded", () => {
    // main.ts is UI/DOM-bound; assert the wiring by reading the source so the
    // guarantee survives refactors of the module's internals.
    const src = readFileSync("js/main.ts", "utf8");
    const idx = src.indexOf("game.onDraw =");
    expect(idx).toBeGreaterThan(-1);
    const handler = src.slice(idx, idx + 400);
    // The handler must record the draw; it may go through the shared
    // recordFinishedGame helper (used by onGameOver) or call
    // recordGameResult directly with a null winner.
    expect(handler).toMatch(/recordFinishedGame\(null\)|recordGameResult/);
  });
});
