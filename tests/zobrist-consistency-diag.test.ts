import { test, describe, expect } from "vitest";
import { Game } from "../js/game.ts";
import { generateBoard } from "../js/board.ts";
import {
  computeZobristHash,
  simulateMove,
  undoMove,
  getAllActions,
} from "../js/ai-core.ts";
import type { IGame } from "../js/types.ts";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("zobrist incremental vs full", () => {
  test("incremental chain matches full hash over random plies", () => {
    const rng = mulberry32(12345);
    let mismatches = 0;
    let total = 0;
    for (let trial = 0; trial < 30; trial++) {
      const game = new Game();
      game.init(generateBoard());
      const g = game as unknown as IGame & { _zobristHash?: bigint };
      g._zobristHash = computeZobristHash(g);
      const stack: any[] = [];
      for (let ply = 0; ply < 12; ply++) {
        if (g.state === "game_over") break;
        const actions = getAllActions(g, g.currentFaction);
        if (!actions.length) break;
        const a = actions[Math.floor(rng() * actions.length)]!;
        const undo = simulateMove(g, a.piece, a.target);
        stack.push(undo);
        total++;
        if (g._zobristHash! !== computeZobristHash(g)) mismatches++;
      }
      while (stack.length) undoMove(g, stack.pop());
    }
    console.log(`${mismatches}/${total} mismatches`);
    expect(mismatches).toBe(0);
  });
});
