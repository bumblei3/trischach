import type { Faction } from "./types.ts";

const HUMAN_FACTIONS: ReadonlySet<string> = new Set([
  "fire",
  "water",
  "nature",
]);

/** Select value "" and anything unknown mean hotseat (every faction is human). */
export function parseHumanFaction(
  value: string | null | undefined,
): Faction | null {
  if (value != null && HUMAN_FACTIONS.has(value)) return value as Faction;
  return null;
}

/**
 * True when the side to move should be played by the engine.
 * Hotseat, auto-battle, a finished game, an open overlay, and an in-flight
 * search all keep the engine quiet.
 */
export function isSoloAiTurn(args: {
  humanFaction: Faction | null;
  currentFaction: Faction;
  autoBattle: boolean;
  gameOver: boolean;
  blocked: boolean;
  inFlight: boolean;
}): boolean {
  if (args.humanFaction == null) return false;
  if (args.autoBattle || args.gameOver || args.blocked || args.inFlight) {
    return false;
  }
  return args.currentFaction !== args.humanFaction;
}
