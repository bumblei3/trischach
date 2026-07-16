/**
 * Endgame Tablebases (Syzygy-style, 3-player).
 *
 * Provides perfect-play evaluation for positions with very few pieces, where
 * the engine's heuristic search is unreliable. A position is identified by its
 * Zobrist hash (see computeZobristHash in ai-core.ts), so the tablebase is a
 * simple hash → result map.
 *
 * 3-player caveat: there is no unique "stronger" piece (RPS cycles F→N→W→F),
 * so a true perfect tablebase is not well-defined. We use a pragmatic rule:
 * the last surviving faction wins; simultaneous elimination is a draw. The
 * generator (scripts/gen-tablebase.ts) builds the map via retrograde analysis
 * under this rule. The result is "good, not provably perfect" — sufficient for
 * the "3–4 stones first" roadmap goal.
 *
 * Lookup hook lives in ai-core.ts (minimax), gated by isTablebasePosition so
 * normal search is untouched for middlegames.
 */

import { computeZobristHash } from "./ai-core.ts";
import { Game } from "./game.ts";
import type { Faction } from "./types.ts";

export type TbResult = "win" | "loss" | "draw" | "unknown";

export interface TablebaseEntry {
  /** Result from the side-to-move's perspective. */
  result: TbResult;
  /** Distance-to-zero (plies to a position with no tablebase-relevant moves). */
  dtz: number;
}

// Internal storage: hash (string, bigint-safe) → entry.
const store = new Map<string, TablebaseEntry>();
let loaded = false;

/** Material count threshold: positions with ≤ this many alive pieces use TB. */
export const TB_PIECE_LIMIT = 4;

/**
 * Mark a position as a tablebase position: few enough pieces that the
 * retrograde generator covered it. We require ≤ TB_PIECE_LIMIT alive pieces
 * AND at least one faction already eliminated (otherwise it is a middlegame).
 */
export function isTablebasePosition(game: {
  getAlivePieces(): { alive: boolean }[];
  eliminatedFactions: Set<Faction>;
}): boolean {
  // Guard: only real Game/IGame objects have getAlivePieces. Serialized
  // states (worker payloads, mocks) are not tablebase positions.
  if (typeof game.getAlivePieces !== "function") return false;
  const alive = game.getAlivePieces().filter((p) => p.alive).length;
  if (alive > TB_PIECE_LIMIT) return false;
  // Need at least one elimination to be an "endgame" worth probing.
  return game.eliminatedFactions.size >= 1;
}

/** Load tablebase JSON files from the given directory (absolute or relative). */
export function loadTablebaseFromJSON(
  entries: Record<string, { r: TbResult; dtz: number }>,
): void {
  for (const [key, v] of Object.entries(entries)) {
    store.set(key, { result: v.r, dtz: v.dtz });
  }
  loaded = true;
}

/** Reset internal store (test helper). */
export function clearTablebase(): void {
  store.clear();
  loaded = false;
}

/**
 * Probe the tablebase for a position. Returns null if not in the table (or not
 * a tablebase position). The result is from the side-to-move perspective.
 */
export function probeTablebase(game: {
  getAlivePieces(): { alive: boolean }[];
  eliminatedFactions: Set<Faction>;
}): TablebaseEntry | null {
  if (!isTablebasePosition(game)) return null;
  const hash = computeZobristHash(game as unknown as Game);
  const entry = store.get(hash.toString());
  return entry ?? null;
}

/**
 * Convert a tablebase result into a search score (same scale as evalForSearch:
 * king ≈ 10000, mate sign by perspective). `maximizingFaction` is the side the
 * search is maximizing for; the TB result is from the side-to-move perspective,
 * so we flip if the side-to-move is NOT the maximizing faction.
 */
export function tablebaseToScore(
  entry: TablebaseEntry,
  sideToMove: Faction,
  maximizingFaction: Faction,
): number {
  const MATE = 10000;
  let raw: number;
  if (entry.result === "win") raw = MATE - entry.dtz;
  else if (entry.result === "loss") raw = -MATE + entry.dtz;
  else raw = 0; // draw
  // Flip perspective if the side to move is the opponent of the maximizer.
  const fromMaximizerView = sideToMove === maximizingFaction ? raw : -raw;
  return fromMaximizerView;
}
