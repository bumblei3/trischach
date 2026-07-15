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
import type { AIAction, Faction, IGame } from "./types.ts";

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
}

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
    };
  }

  const staticScore = evaluateBoard(game, faction);
  const prevDepth = getAIDepth();
  let bestMove: AIAction | null = null;
  try {
    setAIDepth(Math.max(1, Math.min(4, depth)));
    bestMove = calculateBestMove(game, faction);
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
  };
}
