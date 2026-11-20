/**
 * gen-nnue-data.ts — Phase 1 des datengenerierten NNUE (Distillation).
 *
 * Schreibt Selbstspiel-Stellungen aus Auto-Battle-Partien als JSONL, jeweils mit
 * dem Ziel `evaluateLeaf(game, faction)` aus Sicht der ziehenden Fraktion. Das
 * Ziel ist bewusst keine Partieausgabe (in 3P enden Partien fast nie durch
 * Eliminierung → TD-Labels wären fast immer 0), sondern die Bewertung der
 * vorhandenen Engine — das Modell soll diese nachbilden.
 *
 * Format pro Zeile:
 *   {"f":0,"elim":[],"pieces":[["pawn","fire",-4,5,true],...],"target":-12.34}
 *
 *   f       Fraktion, aus deren Sicht bewertet wird (0=fire, 1=water, 2=nature)
 *   elim    eliminierte Fraktionen (Indizes)
 *   pieces  [typ, fraktion, q, r, alive]
 *   target  evaluateLeaf(game, f) zum Aufzeichnungszeitpunkt
 *
 * Run:
 *   npx tsx scripts/gen-nnue-data.ts --games=200 --every=2 --out=data/nnue/train.jsonl
 *
 * Ausgabe liegt unter data/ und ist nicht im Repo (Binärdaten).
 */
import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import type { Faction, Piece } from "../js/types.ts";
import {
  calculateBestMove,
  setAIDepth,
  setPersonality,
  evaluateLeaf,
} from "../js/ai-core.ts";
import { loadOpeningBook } from "../js/opening-book.ts";
import { writeFileSync, mkdirSync } from "node:fs";

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];
const FACTION_INDEX: Record<Faction, number> = {
  fire: 0,
  water: 1,
  nature: 2,
};
const PROFILES = ["balanced", "aggressive", "defensive", "tactical"] as const;

function encode(game: Game, faction: Faction): string {
  const pieces = game
    .getAlivePieces()
    .map(
      (p: Piece) =>
        [p.type, p.faction, p.pos.q, p.pos.r, p.alive] as [
          string,
          Faction,
          number,
          number,
          boolean,
        ],
    );
  const elim = [...game.eliminatedFactions].map((f) => FACTION_INDEX[f]);
  const target = evaluateLeaf(game as never, faction);
  return JSON.stringify({
    f: FACTION_INDEX[faction],
    elim,
    pieces,
    target,
  });
}

async function main(): Promise<void> {
  const games = Number(process.argv[2]?.replace("--games=", "") ?? 200);
  const every = Number(process.argv[3]?.replace("--every=", "") ?? 2);
  const out = process.argv[4]?.replace("--out=", "") ?? "data/nnue/train.jsonl";

  await loadOpeningBook();
  mkdirSync(out.slice(0, out.lastIndexOf("/")), { recursive: true });

  const lines: string[] = [];
  for (let i = 0; i < games; i++) {
    setPersonality(PROFILES[i % PROFILES.length]!);
    setAIDepth(3);
    const g = new Game();
    g.init(generateBoard());
    let ply = 0;
    while (ply < 200) {
      const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
      if (alive.length <= 1) break;
      const faction = TURNS[g.currentFactionIdx]!;
      if (ply % every === 0) {
        lines.push(encode(g, faction));
      }
      const mv = calculateBestMove(g, faction);
      if (!mv) break;
      g.handleCellClick(mv.piece.pos);
      g.handleCellClick(mv.target);
      if (g.pendingPromotion) g.completePromotion("queen");
      ply++;
    }
    if (lines.length >= 200_000) break;
  }

  writeFileSync(out, lines.join("\n") + "\n");
  console.log(
    `geschrieben: ${lines.length} Stellungen nach ${out} (${games} Partien, every=${every})`,
  );
}

void main();
