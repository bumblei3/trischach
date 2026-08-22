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

describe("zobrist chain with getAllActions probes", () => {
  test("incremental chain matches full hash incl. after getAllActions", () => {
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
        total++;
        if (g._zobristHash! !== computeZobristHash(g)) {
          mismatches++;
          console.log(`MISMATCH after-getAllActions trial ${trial} ply ${ply}`);
        }
        if (!actions.length) break;
        const a = actions[Math.floor(Math.random() * actions.length)]!;
        const undo = simulateMove(g, a.piece, a.target);
        stack.push(undo);
        total++;
        if (g._zobristHash! !== computeZobristHash(g)) {
          mismatches++;
          console.log(`MISMATCH after-simulate trial ${trial} ply ${ply} died=${undo.attackerDied} elim=${undo.eliminatedFaction ?? "-"}`);
        }
      }
      while (stack.length) undoMove(g, stack.pop());
    }
    console.log(`${mismatches}/${total} mismatches`);
    expect(mismatches).toBe(0);
  });
});
