import { test } from "vitest";
import { Game } from "../js/game.ts";
import { generateBoard } from "../js/board.ts";
import {
  computeZobristHash,
  simulateMove,
  undoMove,
  rebuildOccupiedMap,
  getAllActions,
  ZOBRIST_PIECE_KEYS,
  ZOBRIST_SIDE_KEYS,
} from "../js/ai-core.ts";
import { isKingdomCheck } from "../js/game-check.ts";
import type { IGame, Faction } from "../js/types.ts";

const TYPES = ["king","queen","rook","bishop","knight","pawn"];
const FACS = ["fire","water","nature"];

function decompose(xor: bigint): string {
  const singles: string[] = [];
  for (let pt = 0; pt < TYPES.length; pt++) {
    for (let fa = 0; fa < 3; fa++) {
      const arr = ZOBRIST_PIECE_KEYS[pt]![fa] as bigint[];
      for (let sq = 0; sq < arr.length; sq++) {
        if (arr[sq] === xor) singles.push(`${TYPES[pt]}/${FACS[fa]}/sq${sq}`);
      }
    }
  }
  for (let i = 0; i < 3; i++) if (ZOBRIST_SIDE_KEYS[i] === xor) singles.push(`side${i}`);
  return singles.join(",") || "multi/none";
}

test("decompose after-undo xor", () => {
  let rngState = 42;
  const rand = (): number => {
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
    return rngState / 0x7fffffff;
  };
  outer: for (let trial = 0; trial < 60; trial++) {
    const game = new Game();
    game.init(generateBoard());
    const g = game as any;
    g._zobristHash = computeZobristHash(g);
    for (let ply = 0; ply < 14; ply++) {
      if (g.state === "game_over") break;
      const pieces = g.pieces.filter((p: any) => p.alive && p.faction === g.currentFaction);
      for (const piece of pieces) {
        const actions = getAllActions(g, g.currentFaction).filter((x: any) => x.piece === piece);
        for (const a of actions) {
          const savedIdx = g.currentFactionIdx;
          const undo = simulateMove(g, piece, a.target);
          g.currentFactionIdx = undo.prevFactionIdx;
          rebuildOccupiedMap(g);
          isKingdomCheck(g, piece.faction);
          g.currentFactionIdx = savedIdx;
          rebuildOccupiedMap(g);
          undoMove(g, undo);
          const inc = g._zobristHash!;
          const full = computeZobristHash(g);
          if (inc !== full) {
            console.log(`case: ${piece.faction}_${piece.type} ${piece.pos.key}->${a.target.key} type=${a.type} elim=${undo.eliminatedFaction ?? "-"}`);
            console.log(`xor=${(inc ^ full).toString(16)} matches=[${decompose(inc ^ full)}]`);
            // state diff
            break outer;
          }
        }
      }
      const actions = getAllActions(g, g.currentFaction);
      if (!actions.length) break;
      const a2 = actions[Math.floor(rand() * actions.length)]!;
      simulateMove(g, a2.piece, a2.target);
    }
  }
});
