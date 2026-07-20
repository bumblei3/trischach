/**
 * engine-strength-debug.ts — reproduziert den Random-Verlust und loggt
 * verlorene Partien, damit wir den 3P-Search-Bug isolieren können.
 *
 * Wiederverwendet playGame-Logik aus engine-strength.ts, aber zeichnet
 * pro Zug (faction, zug, eliminierte Fraktionen, material-stand) auf und
 * schreibt verlorene Partien in scripts/engine-strength-debug.log.
 *
 * Run:
 *   npx tsx scripts/engine-strength-debug.ts [games] [depth] [seed] [maxLog]
 *   npx tsx scripts/engine-strength-debug.ts 20 3 12345 3
 */
import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import type { Faction } from "../js/types.ts";
import {
  calculateBestMove,
  setAIDepth,
  setTieBreakMode,
  getLegalMoves,
} from "../js/ai-core.ts";
import { Piece } from "../js/pieces.ts";
import type { Hex } from "../js/hex.ts";
import * as fs from "node:fs";

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomLegalMove(
  g: Game,
  faction: Faction,
  rng: () => number,
): { piece: Piece; target: Hex } | null {
  const pieces = g.getAlivePieces().filter((p) => p.alive && p.faction === faction);
  const moves: { piece: Piece; target: Hex }[] = [];
  for (const piece of pieces) {
    const lm = getLegalMoves(g as any, piece);
    for (const m of lm.moves) moves.push({ piece, target: m });
    for (const a of lm.attacks) moves.push({ piece, target: a });
  }
  if (moves.length === 0) return null;
  const idx = Math.floor(rng() * moves.length);
  return moves[idx]!;
}

function material(g: Game, f: Faction): number {
  const v: Record<string, number> = {
    pawn: 1,
    knight: 3,
    bishop: 3,
    rook: 5,
    queen: 9,
    king: 0,
  };
  return g
    .getAlivePieces()
    .filter((p) => p.alive && p.faction === f)
    .reduce((s, p) => s + (v[p.type] ?? 0), 0);
}

function playGameLogged(
  engineFaction: Faction,
  depth: number,
  rng: () => number,
  maxPlies = 200,
): { result: "engine" | "opp" | "draw"; log: string[] } {
  const g = new Game();
  g.init(generateBoard());
  setAIDepth(depth);
  setTieBreakMode(true);
  const log: string[] = [];
  log.push(
    `=== game | engine=${factionName(engineFaction)} | depth=${depth} | start material F/W/N = ${material(g, FACTION.FIRE)}/${material(g, FACTION.WATER)}/${material(g, FACTION.NATURE)}`,
  );
  let ply = 0;
  while (ply < maxPlies) {
    const alive = TURNS.filter((f) => !g.eliminatedFactions.has(f));
    if (alive.length <= 1) {
      const w = alive[0] === engineFaction ? "engine" : "opp";
      log.push(`END ply=${ply} winner=${w}`);
      return { result: alive.length === 1 ? (w as any) : "draw", log };
    }
    const faction = TURNS[g.currentFactionIdx]!;
    let mv: { piece: Piece; target: Hex } | null;
    let src = "?";
    if (faction === engineFaction) {
      mv = calculateBestMove(g, faction);
      src = "ENGINE";
    } else {
      mv = randomLegalMove(g, faction, rng);
      src = "RAND";
    }
    if (!mv) {
      log.push(`END ply=${ply} no-move ${factionName(faction)} -> draw`);
      return { result: "draw", log };
    }
    const targetPiece = g
      .getAlivePieces()
      .find((p) => p.alive && p.pos.equals(mv.target));
    const isCapture = !!targetPiece;
    log.push(
      `ply=${ply} ${factionName(faction)}[${src}] ${mv.piece.type}@${mv.piece.pos.toString()} -> ${mv.target.toString()}${isCapture ? ` CAP(${targetPiece!.faction === faction ? "own?" : factionName(targetPiece!.faction)})` : ""} | alive=${alive.map(factionName).join("")} | mat F/W/N=${material(g, FACTION.FIRE)}/${material(g, FACTION.WATER)}/${material(g, FACTION.NATURE)}`,
    );
    g.handleCellClick(mv.piece.pos);
    g.handleCellClick(mv.target);
    if (g.pendingPromotion) g.completePromotion("queen");
    ply++;
  }
  log.push(`END ply=${ply} maxplies -> draw`);
  return { result: "draw", log };
}

function factionName(f: Faction): string {
  return f === FACTION.FIRE ? "F" : f === FACTION.WATER ? "W" : "N";
}

function main(): void {
  const argv = process.argv.slice(2);
  const games = Number(argv[0] ?? 20);
  const depth = Number(argv[1] ?? 3);
  const seed = Number(argv[2] ?? 12345);
  const maxLog = Number(argv[3] ?? 3);
  const rng = mulberry32(seed);
  let eWins = 0,
    eLosses = 0,
    draws = 0;
  const allLogs: string[][] = [];
  for (let i = 0; i < games; i++) {
    const ef = TURNS[i % TURNS.length]!;
    const { result, log } = playGameLogged(ef, depth, rng);
    if (result === "engine") eWins++;
    else if (result === "opp") eLosses++;
    else draws++;
    if (allLogs.length < maxLog) allLogs.push(log);
  }
  const score = (eWins + 0.5 * draws) / games;
  console.log(
    `DEBUG | depth=${depth} games=${games} seed=${seed} | W${eWins} L${eLosses} D${draws} | score ${(score * 100).toFixed(1)}%`,
  );
  const lossLogs = allLogs.filter((l) => l.some((x) => x.startsWith("END") && x.includes("winner=opp")));
  if (lossLogs.length) {
    const out =
      lossLogs.map((l) => l.join("\n")).join("\n\n") +
      `\n\n=== SUMMARY W${eWins} L${eLosses} D${draws} ===\n`;
    fs.writeFileSync("scripts/engine-strength-debug.log", out);
    console.log(`wrote ${lossLogs.length} lost-game logs -> scripts/engine-strength-debug.log`);
  }
}

const isDirectRun =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  /engine-strength-debug\.ts$/.test(process.argv[1] ?? "");
if (isDirectRun) main();
