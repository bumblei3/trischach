/**
 * Position analysis helpers for replay / study mode.
 * Thin wrapper around the engine — no DOM.
 */

import {
  calculateBestMove,
  evaluateBoard,
  getAIDepth,
  setAIDepth,
} from "./ai.ts";
import { getRPSResult } from "./board.ts";
import { simulateMove, undoMove } from "./ai-core.ts";
import type { AIAction, Faction, IGame, Piece } from "./types.ts";

export interface PositionAnalysis {
  faction: Faction;
  /** Static eval from the side to move (handcrafted / NNUE if enabled). */
  staticScore: number;
  /** Human-readable static eval label. */
  scoreLabel: string;
  /** Best move from a shallow search, if any. */
  bestMove: AIAction | null;
  /** Compact SAN-like notation for the recommended move. */
  san: string | null;
  depth: number;
  gameOver: boolean;
  /** Principal variation: SAN-like notation for the expected line (2–4 plies). */
  pv: string[];
  /** RPS rationale for the recommended move / side situation. */
  rpsExplanation: string | null;
}

/** Faction display names for RPS explanations. */
const FACTION_NAME: Record<Faction, string> = {
  fire: "Feuer",
  water: "Wasser",
  nature: "Natur",
};

/**
 * Format a raw eval score for the UI.
 * King value is 10000 — treat |score| ≥ 5000 as decisive.
 */
export function formatEvalScore(score: number): string {
  if (!Number.isFinite(score)) return "–";
  if (score >= 5000) return "Matt+";
  if (score <= -5000) return "Matt−";
  const sign = score > 0 ? "+" : "";
  // Scale roughly to "pawns": queen≈9, so divide by ~100 of piece units
  // (base pawn strength is small). Keep one decimal of the raw units / 10.
  return `${sign}${(score / 10).toFixed(1)}`;
}

/** Compact engine move string: Q0,0x1,2 or P-1,2-0,3 */
export function formatEngineMove(action: AIAction): string {
  const piece = action.piece;
  const letter =
    piece.type === "pawn" ? "" : (piece.type[0] ?? "?").toUpperCase();
  const cap = action.type === "attack" ? "x" : "-";
  return `${letter}${piece.pos.q},${piece.pos.r}${cap}${action.target.q},${action.target.r}`;
}

/**
 * Analyze the current position: static eval + best move at the given depth.
 * Restores the previous AI depth afterwards.
 */
export function analyzePosition(
  game: IGame,
  depth: number = 2,
): PositionAnalysis {
  const faction = game.currentFaction as Faction;
  const gameOver =
    (game.state as string) === "game_over" ||
    (game.eliminatedFactions instanceof Set &&
      game.eliminatedFactions.size >= 2);

  if (gameOver) {
    return {
      faction,
      staticScore: 0,
      scoreLabel: "Partie beendet",
      bestMove: null,
      san: null,
      depth: 0,
      gameOver: true,
      pv: [],
      rpsExplanation: null,
    };
  }

  const staticScore = evaluateBoard(game, faction);
  const prevDepth = getAIDepth();
  let bestMove: AIAction | null = null;
  let pv: string[] = [];
  let rpsExplanation: string | null = null;
  try {
    setAIDepth(Math.max(1, Math.min(4, depth)));
    bestMove = calculateBestMove(game, faction);
    if (bestMove) {
      pv = buildPrincipalVariation(game, faction, depth, bestMove);
      rpsExplanation = explainRPS(game, bestMove);
    }
  } finally {
    setAIDepth(prevDepth);
  }

  return {
    faction,
    staticScore,
    scoreLabel: formatEvalScore(staticScore),
    bestMove,
    san: bestMove ? formatEngineMove(bestMove) : null,
    depth: Math.max(1, Math.min(4, depth)),
    gameOver: false,
    pv,
    rpsExplanation,
  };
}

/**
 * Render a `PositionAnalysis` to an HTML string for the replay-analysis panel.
 * Returns markup with `.analysis-pv` (principal variation) and `.analysis-rps`
 * (RPS rationale) blocks when available, matching the styles in style.css.
 */
export function renderAnalysisToHTML(result: PositionAnalysis): string {
  if (result.gameOver) {
    return `<span class="analysis-label">Status:</span> Partie beendet`;
  }
  const factionName = FACTION_NAME[result.faction] ?? result.faction;
  if (result.san) {
    const pvLine = result.pv.length
      ? `<div class="analysis-pv">${result.pv
          .map((m) => escapeHtml(m))
          .join('<span class="analysis-pv-sep"> → </span>')}</div>`
      : "";
    const rps = result.rpsExplanation
      ? `<div class="analysis-rps">${escapeHtml(result.rpsExplanation)}</div>`
      : "";
    return (
      `<span class="analysis-label">Engine empfiehlt</span>` +
      `<span class="analysis-san">${escapeHtml(result.san)}</span>` +
      `<span class="analysis-score">(${escapeHtml(result.scoreLabel)} · ${escapeHtml(factionName)} · d${result.depth})</span>` +
      pvLine +
      rps
    );
  }
  return (
    `<span class="analysis-label">Eval</span>` +
    `<span class="analysis-score">${escapeHtml(result.scoreLabel)}</span>` +
    `<span class="analysis-label"> · kein Zug · ${escapeHtml(factionName)}</span>`
  );
}

/** Minimal HTML escaper for safe injection into the analysis panel. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build a principal variation by iteratively playing the engine's best move
 * and re-searching. Uses `simulateMove`/`undoMove` so the passed `game` is
 * left unchanged (all undos are applied in reverse order at the end).
 */
function buildPrincipalVariation(
  game: IGame,
  faction: Faction,
  depth: number,
  firstMove: AIAction,
  plies: number = 4,
): string[] {
  const line: string[] = [formatEngineMove(firstMove)];
  const undos: ReturnType<typeof simulateMove>[] = [];
  let undoAll = (): void => {
    for (let i = undos.length - 1; i >= 0; i--)
      undoMove(game as any, undos[i]!);
  };
  try {
    // Apply the first move so we can search the reply.
    undos.push(simulateMove(game as any, firstMove.piece, firstMove.target));
    for (let p = 1; p < plies; p++) {
      // After a move the side to move rotates (FIRE→WATER→NATURE).
      const nextFaction = game.currentFaction as Faction;
      const mv = calculateBestMove(game, nextFaction);
      if (!mv) break;
      line.push(formatEngineMove(mv));
      undos.push(simulateMove(game as any, mv.piece, mv.target));
    }
  } finally {
    undoAll();
  }
  return line;
}

/**
 * Human-readable RPS rationale for the recommended move.
 * - Attack moves: explain whether the target is won/lost in the RPS cycle.
 * - Non-attack moves: summarise the side's overall RPS standing.
 */
export function explainRPS(game: IGame, move: AIAction): string | null {
  if (move.type === "attack") {
    const target = game.getPieceAt(move.target);
    if (!target) return null;
    const rps = getRPSResult(move.piece.faction, target.faction);
    if (rps === "advantage") {
      return `Schlägt eine ${FACTION_NAME[target.faction]}-Figur, die du im Stein-Schere-Papier-Zyklus schlägst (Vorteil).`;
    }
    if (rps === "disadvantage") {
      return `Greift eine ${FACTION_NAME[target.faction]}-Figur an, gegen die du im RPS-Zyklus im Nachteil bist (Risiko: du verlierst im Tausch).`;
    }
    return `Greift eine ${FACTION_NAME[target.faction]}-Figur an (neutral im RPS-Zyklus).`;
  }
  // Non-attack: summarise RPS standing for the moving side.
  const living = game.getAlivePieces().filter((p: Piece) => p.alive);
  const livingFactions = Array.from(new Set(living.map((p) => p.faction)));
  const adv = livingFactions.filter(
    (f) =>
      f !== move.piece.faction &&
      getRPSResult(move.piece.faction, f) === "advantage",
  );
  const dis = livingFactions.filter(
    (f) =>
      f !== move.piece.faction &&
      getRPSResult(move.piece.faction, f) === "disadvantage",
  );
  const parts: string[] = [];
  if (adv.length)
    parts.push(`schlägst ${adv.map((f) => FACTION_NAME[f]).join("/")}`);
  if (dis.length)
    parts.push(`unterliegst ${dis.map((f) => FACTION_NAME[f]).join("/")}`);
  if (!parts.length) return `RPS-Lage ausgeglichen.`;
  return `Deine ${FACTION_NAME[move.piece.faction]}-Seite ${parts.join(", ")} im RPS-Zyklus.`;
}
