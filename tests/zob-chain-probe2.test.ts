import { test } from "vitest";
import { Game } from "../js/game.ts";
import { generateBoard } from "../js/board.ts";
import {
  computeZobristHash,
  simulateMove,
  undoMove,
  rebuildOccupiedMap,
  getAllActions,
} from "../js/ai-core.ts";
import { isKingdomCheck } from "../js/game-check.ts";
import type { IGame, Faction } from "../js/types.ts";

function probed(game: IGame, piece: any, target: any, faction: Faction): string {
  const g = game as any;
  const savedIdx = game.currentFactionIdx;
  const undo = simulateMove(game, piece, target);
  game.currentFactionIdx = undo.prevFactionIdx;
  rebuildOccupiedMap(game);
  const inCheck = isKingdomCheck(game, faction);
  game.currentFactionIdx = savedIdx;
  rebuildOccupiedMap(game);
  undoMove(game, undo);
  if (g._zobristHash !== computeZobristHash(g)) {
    return `after-undo elim=${undo.eliminatedFaction ?? "-"} died=${undo.attackerDied}`;
  }
  void inCheck;
  return "clean";
}

test("probe final state only", () => {
  let rngState = 42;
  const rand = (): number => {
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
    return rngState / 0x7fffffff;
  };
  for (let trial = 0; trial < 60; trial++) {
    const game = new Game();
    game.init(generateBoard());
    const g = game as any;
    g._zobristHash = computeZobristHash(g);
    for (let ply = 0; ply < 14; ply++) {
      if (g.state === "game_over") break;
      const pieces = g.pieces.filter((p: any) => p.alive && p.faction === g.currentFaction);
      let found = false;
      for (const piece of pieces) {
        const actions = getAllActions(g, g.currentFaction).filter((x: any) => x.piece === piece);
        for (const a of actions) {
          const step = probed(g, piece, a.target, piece.faction);
          if (step !== "clean") {
            console.log(`trial ${trial} ply ${ply}: ${piece.faction}_${piece.type} ${piece.pos.key}->${a.target.key} type=${a.type} diverged at ${step}`);
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (found) return;
      const actions = getAllActions(g, g.currentFaction);
      if (!actions.length) break;
      const a = actions[Math.floor(rand() * actions.length)]!;
      simulateMove(g, a.piece, a.target);
    }
  }
});
