// ─── Game Statistics ─────────────────────────────────────────────────────
// Local, client-side only: records finished games and exposes aggregate
// stats for the statistics dashboard. No network, no accounts.

import type { Faction } from "./types.ts";

export const GAME_STATS_KEY = "trischach-game-stats";
export const GAME_STATS_MAX_ENTRIES = 500;

export type GameMode = "auto" | "manual";

export interface GameRecord {
  /** ISO date of the finished game. */
  date: string;
  mode: GameMode;
  /** Winning faction, or null for a draw. */
  winner: Faction | null;
  /** Number of moves (half-moves logged) in the game. */
  moves: number;
}

export interface GameStats {
  totalGames: number;
  winsFire: number;
  winsWater: number;
  winsNature: number;
  draws: number;
  autoGames: number;
  manualGames: number;
  /** Games won per faction in manual (human-played) games. */
  manualWins: Record<Faction, number>;
  recent: GameRecord[];
}

function emptyStats(): GameStats {
  return {
    totalGames: 0,
    winsFire: 0,
    winsWater: 0,
    winsNature: 0,
    draws: 0,
    autoGames: 0,
    manualGames: 0,
    manualWins: { fire: 0, water: 0, nature: 0 },
    recent: [],
  };
}

export function loadGameStats(): GameStats {
  try {
    const raw = localStorage.getItem(GAME_STATS_KEY);
    if (!raw) return emptyStats();
    const parsed = JSON.parse(raw) as Partial<GameStats>;
    const stats = emptyStats();
    stats.totalGames = Number(parsed.totalGames) || 0;
    stats.winsFire = Number(parsed.winsFire) || 0;
    stats.winsWater = Number(parsed.winsWater) || 0;
    stats.winsNature = Number(parsed.winsNature) || 0;
    stats.draws = Number(parsed.draws) || 0;
    stats.autoGames = Number(parsed.autoGames) || 0;
    stats.manualGames = Number(parsed.manualGames) || 0;
    if (parsed.manualWins && typeof parsed.manualWins === "object") {
      for (const f of ["fire", "water", "nature"] as Faction[]) {
        stats.manualWins[f] = Number(parsed.manualWins[f]) || 0;
      }
    }
    if (Array.isArray(parsed.recent)) {
      stats.recent = parsed.recent
        .filter(
          (r): r is GameRecord =>
            !!r &&
            typeof r === "object" &&
            typeof r.date === "string" &&
            (r.mode === "auto" || r.mode === "manual") &&
            typeof r.moves === "number",
        )
        .slice(0, GAME_STATS_MAX_ENTRIES);
    }
    return stats;
  } catch (e) {
    console.warn("Failed to load game stats:", e);
    return emptyStats();
  }
}

function saveGameStats(stats: GameStats): void {
  try {
    localStorage.setItem(GAME_STATS_KEY, JSON.stringify(stats));
  } catch (e) {
    console.warn("Failed to save game stats:", e);
  }
}

/** Record a finished game. Returns the updated stats. */
export function recordGameResult(record: {
  winner: Faction | null;
  mode: GameMode;
  moves: number;
  now?: Date;
}): GameStats {
  const stats = loadGameStats();
  const date = (record.now ?? new Date()).toISOString().split("T")[0]!;

  stats.totalGames += 1;
  if (record.winner === "fire") stats.winsFire += 1;
  else if (record.winner === "water") stats.winsWater += 1;
  else if (record.winner === "nature") stats.winsNature += 1;
  else stats.draws += 1;

  if (record.mode === "auto") stats.autoGames += 1;
  else {
    stats.manualGames += 1;
    if (record.winner) stats.manualWins[record.winner] += 1;
  }

  stats.recent.unshift({ date, ...record });
  if (stats.recent.length > GAME_STATS_MAX_ENTRIES) {
    stats.recent.length = GAME_STATS_MAX_ENTRIES;
  }

  saveGameStats(stats);
  return stats;
}

/** Reset all recorded game statistics (dashboard "Zurücksetzen" button). */
export function resetGameStats(): void {
  try {
    localStorage.removeItem(GAME_STATS_KEY);
  } catch (e) {
    console.warn("Failed to reset game stats:", e);
  }
}
