/**
 * Solo UX coach helpers for TriSchach: RPS capture previews + "what now?" messages.
 * Pure functions — no DOM dependency (easy to unit-test).
 */
import { FACTION_COLORS, getRPSResult } from "./board.ts";
import type { Faction, RPSResult, Piece } from "./types.ts";
import type { Hex } from "./hex.ts";

export type CoachTone = "info" | "check" | "rps-good" | "rps-bad" | "warn";

export interface CoachMessage {
  text: string;
  tone: CoachTone;
}

export interface RpsBuckets {
  advantage: Hex[];
  neutral: Hex[];
  disadvantage: Hex[];
}

const FACTION_EMOJI: Record<Faction, string> = {
  fire: "🔥",
  water: "🌊",
  nature: "🌿",
};

/** Short German label for an RPS outcome from the attacker's perspective. */
export function describeRps(rps: RPSResult): string {
  if (rps === "advantage") return "Vorteil — du schlägst normal";
  if (rps === "disadvantage") return "Nachteil — DU wirst geschlagen!";
  return "Neutral — klassischer Schlag";
}

/** Title/tooltip for a capture cell. */
export function rpsCaptureTitle(
  attacker: Faction,
  defender: Faction,
  rps: RPSResult,
): string {
  const a = FACTION_EMOJI[attacker] || attacker;
  const d = FACTION_EMOJI[defender] || defender;
  return `${a} → ${d}: ${describeRps(rps)}`;
}

/** Build title from pieces via getRPSResult. */
export function rpsCaptureTitleFromPieces(
  attacker: Piece,
  defender: Piece,
): string {
  const rps = getRPSResult(attacker.faction, defender.faction);
  return rpsCaptureTitle(attacker.faction, defender.faction, rps);
}

/**
 * Coach line for the current game state (solo human or AI turn).
 * @param game Minimal game surface used by the UI
 */
export function getCoachMessage(game: {
  state: string;
  currentFaction: Faction;
  rpsEnabled: boolean;
  selectedPiece: Piece | null;
  validMoves: Hex[];
  validAttacks: Hex[];
  isKingInCheck: (_f: Faction) => boolean;
  getPieceAt: (_h: Hex) => Piece | null | undefined;
  isAIFaction?: (_f: Faction) => boolean;
}): CoachMessage {
  const f = game.currentFaction;
  const name = FACTION_COLORS[f]?.name ?? f;

  if (game.state === "game_over") {
    return { text: "Partie beendet", tone: "info" };
  }

  if (game.isAIFaction?.(f)) {
    return { text: `${name} denkt…`, tone: "info" };
  }

  if (game.isKingInCheck(f)) {
    return {
      text: `⚠️ Schach — ${name} muss dem Schach entkommen`,
      tone: "check",
    };
  }

  if (game.state === "select_piece" || game.state === "SELECT_PIECE") {
    return {
      text: `Wähle eine Figur von ${name}`,
      tone: "info",
    };
  }

  if (game.state === "select_target" || game.state === "SELECT_TARGET") {
    const piece = game.selectedPiece;
    const nMoves = game.validMoves?.length ?? 0;
    const nAtk = game.validAttacks?.length ?? 0;

    if (game.rpsEnabled && piece && nAtk > 0) {
      let adv = 0;
      let dis = 0;
      for (const h of game.validAttacks) {
        const def = game.getPieceAt(h);
        if (!def) continue;
        const r = getRPSResult(piece.faction, def.faction);
        if (r === "advantage") adv++;
        else if (r === "disadvantage") dis++;
      }
      if (dis > 0 && adv === 0) {
        return {
          text: `Ziel wählen — ⚠️ ${dis} roter Schlag(e): du stirbst (RPS)`,
          tone: "rps-bad",
        };
      }
      if (dis > 0) {
        return {
          text: `Ziel: grün = Vorteil · rot = du stirbst · ${nMoves} Züge`,
          tone: "rps-bad",
        };
      }
      if (adv > 0) {
        return {
          text: `Ziel wählen — ${adv} günstige Schläge (grün) · ${nMoves} Züge`,
          tone: "rps-good",
        };
      }
    }

    if (nMoves + nAtk === 0) {
      return {
        text: "Keine legalen Züge — wähle eine andere Figur",
        tone: "warn",
      };
    }

    return {
      text: `Ziel wählen — ${nMoves} Züge · ${nAtk} Angriffe`,
      tone: "info",
    };
  }

  if (game.state === "promotion" || game.state === "PROMOTION") {
    return { text: "Umwandlung wählen (Q/R/B/N)", tone: "info" };
  }

  return { text: `${name} am Zug`, tone: "info" };
}

/** Whether hex is in the disadvantage attack list. */
export function isDisadvantageHex(
  hex: Hex,
  rpsAttacks: RpsBuckets | null | undefined,
): boolean {
  if (!rpsAttacks?.disadvantage?.length) return false;
  return rpsAttacks.disadvantage.some((h) => h.equals(hex));
}
