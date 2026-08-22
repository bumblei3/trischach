/**
 * Elo helpers shared by engine-strength tooling (ex-NNUE pipeline remnant).
 */

export function eloFromScore(score: number): number {
  if (score <= 0) return -800;
  if (score >= 1) return 800;
  return Math.round((400 * Math.log(score / (1 - score))) / Math.LN10);
}

export function scoreFromWDL(win: number, draw: number, loss: number): number {
  const n = win + draw + loss;
  if (n <= 0) return 0.5;
  return (win + 0.5 * draw) / n;
}
