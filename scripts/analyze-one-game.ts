/**
 * analyze-one-game.ts — Engine-vs-Random Partie-Analyse: jede Engine-Entscheidung
 * mit Top-10-Alternativen vor dem Zug vergleichen. Zeigt, ob die Engine
 * im Mittellspiel (greedy, 1-Ply) den unterbesten Zug wählt oder ob Eval
 * die Ursache ist (Engine wählt konsequent den besten Zug nach ihrer falsch
 * bewertenden Eval → Eval-Struktur ist der Hebel).
 *
 * Kopiere diese Datei nach scripts/analyze-one-game.ts und starte:
 *   npx tsx scripts/analyze-one-game.ts
 *
 * Ausgabe: pro Turn die gewählte Aktion + Score, die Top-10 Alternativen,
 * und die Differenz (diff) zwischen gewähltem und bestem verfügbarem Score.
 * diff=0.0 → Engine wählt den besten Kandidaten → Suche ok, Eval ist das Problem.
 * diff>0 → Engine übersieht bessere Züge → Such-Qualität ist das Problem.
 */

import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import {
  calculateBestMove,
  setAIDepth,
  setTieBreakMode,
  greedyBestMove,
  evaluateBoard,
  getAllActions,
} from "../js/ai-core.ts";
import { simulateMove, undoMove } from "../js/ai-core.ts";
import type { AIAction, Faction } from "../js/types.ts";
import { Hex } from "../js/hex.ts";

// Deterministischer Random-Agent für die beiden nicht-Engine-Fraktionen
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (a >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];
const ENGINE_FACTION: Faction = FACTION.FIRE;
const RNG_SEED = 12345;
const MAX_PLY = 250;

function randomLegalMove(
  game: Game,
  faction: Faction,
  rng: () => number,
): { piece: import("../js/pieces.ts").Piece; target: Hex } | null {
  const pieces = game
    .getAlivePieces()
    .filter((p) => p.alive && p.faction === faction);
  const moves: {
    piece: import("../js/pieces.ts").Piece;
    target: Hex;
    isAttack: boolean;
  }[] = [];
  for (const p of pieces) {
    const { moves: m, attacks: a } = game.getLegalMoves(p);
    for (const t of m)
      moves.push({ piece: p, target: t as Hex, isAttack: false });
    for (const t of a)
      moves.push({ piece: p, target: t as Hex, isAttack: true });
  }
  if (moves.length === 0) return null;
  const idx = Math.floor(rng() * moves.length);
  return { piece: moves[idx]!.piece, target: moves[idx]!.target };
}

function main(): void {
  const rng = mulberry32(RNG_SEED);
  const g = new Game();
  g.init(generateBoard());
  setAIDepth(3);
  setTieBreakMode(true); // deterministisch für Engine-Seite

  let ply = 0;
  let engineTurns = 0;

  console.log(`=== Single-Game Engine-vs-Random Trace ===`);
  console.log(
    `Engine: ${ENGINE_FACTION}, RNG seed: ${RNG_SEED}, max plies: ${MAX_PLY}\n`,
  );

  while (ply < MAX_PLY) {
    const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
    if (alive.length <= 1) {
      const winner = alive.length === 1 ? alive[0] : null;
      console.log(`\n=== Partie beendet nach ${ply} Halbzügen ===`);
      if (winner) {
        const isEngine = winner === ENGINE_FACTION;
        console.log(
          `Sieger: ${winner} (${isEngine ? "ENGINE GEWINNT" : "ENGINE VERLIERT"})`,
        );
      } else {
        console.log("Unentschieden");
      }
      break;
    }

    const faction = TURNS[g.currentFactionIdx]!;
    if (faction === ENGINE_FACTION) {
      engineTurns++;
      const actions = getAllActions(g, faction);
      if (actions.length === 0) {
        console.log(`\n[Turn ${engineTurns}] Engine hat keine Züge — draw`);
        break;
      }

      // Engine-Entscheidung mit berechnung und Score-Aufzeichnung
      const chosen = calculateBestMove(g, faction);
      if (!chosen) {
        console.log(`\n[Turn ${engineTurns}] Engine hat keine BestMove — draw`);
        break;
      }

      // Score des gewählten Zuges berechnen (nach evaluateBoard)
      const undo = simulateMove(g, chosen.piece, chosen.target);
      rebuildOccupiedMap(g);
      const chosenScore = evaluateBoard(g, faction);
      undoMove(g, undo);
      rebuildOccupiedMap(g);

      // Top-N Alternativen vor dem Zug finden (Score-Vergleich)
      const alternatives: { action: AIAction; score: number }[] = [];
      for (const action of actions) {
        if (
          action.piece.id === chosen.piece.id &&
          action.target.equals(chosen.target)
        )
          continue;
        const u = simulateMove(g, action.piece, action.target);
        rebuildOccupiedMap(g);
        const s = evaluateBoard(g, faction);
        undoMove(g, u);
        rebuildOccupiedMap(g);
        alternatives.push({ action, score: s });
      }
      alternatives.sort((a, b) => b.score - a.score);

      // Top-10 ausgeben
      const topN = alternatives.slice(0, 10);
      const bestAltScore = topN.length > 0 ? topN[0]!.score : -Infinity;
      const diff = bestAltScore - chosenScore;

      const regime =
        g.getAlivePieces().length > 16 ? "greedy (1-Ply)" : "minimax";
      console.log(
        `[Turn ${engineTurns} | ${regime}] ` +
          `Engine wählt: ${chosen.piece.type}→${chosen.target.q},${chosen.target.r} ` +
          `Score: ${chosenScore.toFixed(1)} | Diff zum besten Alt: ${diff >= 0 ? "+" : ""}${diff.toFixed(1)}`,
      );
      for (let i = 0; i < topN.length; i++) {
        const alt = topN[i]!;
        const marker =
          alt.action.piece.id === chosen.piece.id &&
          alt.action.target.equals(chosen.target)
            ? "← gewählt"
            : "";
        console.log(
          `    #${i + 1}: ${alt.action.piece.type}→${alt.action.target.q},${alt.action.target.r} Score: ${alt.score.toFixed(1)} ${marker}`,
        );
      }
      if (topN.length === 0) {
        console.log("    (keine Alternativen gefunden)");
      }

      // Zug tatsächlich anwenden (sonst friert die Partie auf dem
      // Engine-Turn ein und alle Turns sind identisch)
      g.handleCellClick(chosen.piece.pos);
      g.handleCellClick(chosen.target);
      if (g.pendingPromotion) g.completePromotion("queen");
    } else {
      // Zufälliger Gegner-Zug
      const mv = randomLegalMove(g, faction, rng);
      if (!mv) {
        console.log(`[Turn ${ply + 1}] ${faction} hat keine Züge`);
        break;
      }
      g.handleCellClick(mv.piece.pos);
      g.handleCellClick(mv.target);
      if (g.pendingPromotion) g.completePromotion("queen");
    }

    ply++;
  }

  if (ply >= MAX_PLY) {
    console.log(`\n=== Max-Ply (${MAX_PLY}) erreicht, Partie abgebrochen ===`);
  }
}

function rebuildOccupiedMap(game: Game): void {
  game._occupiedMap = new Map();
  for (const p of game.pieces) {
    if (p.alive) game._occupiedMap.set(p.pos.key, p);
  }
}

main();
