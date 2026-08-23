/**
 * validate-puzzles.ts — offline validation of every puzzle in puzzles.json.
 *
 * For each puzzle: deserialize the fen, replay the full solution (every move
 * must be legal, final position must be game over), and check first-move
 * uniqueness (hasUniqueSolution). Prints a summary; exits 1 on any failure.
 */
import { readFileSync } from "node:fs";
import { Game } from "../js/game.ts";
import {
  findAllImmediateMatingMoves,
  hasUniqueSolution,
  reconstructGameFromHash,
} from "../js/puzzle.ts";
import { isCheckmateInternal } from "../js/game-check.ts";
import type { Puzzle } from "../js/puzzle.ts";
import { Hex } from "../js/hex.ts";

const raw = readFileSync("puzzles.json", "utf-8");
const data = JSON.parse(raw) as { puzzles: Puzzle[] };

let ok = 0;
const failures: string[] = [];

for (const p of data.puzzles) {
  try {
    const game = reconstructGameFromHash(p.fen);
    if (!game) {
      failures.push(`${p.id}: fen deserialize failed`);
      continue;
    }

    // Replay solution
    let valid = true;
    for (const mv of p.solution) {
      const piece = game.pieces.find(
        (pc) =>
          pc.alive &&
          pc.id === mv.pieceId &&
          pc.pos.q === mv.from.q &&
          pc.pos.r === mv.from.r,
      );
      if (!piece) {
        failures.push(`${p.id}: piece ${mv.pieceId} not at from`);
        valid = false;
        break;
      }
      const sel = game.handleCellClick(piece.pos);
      if (!sel || sel.action !== "select") {
        failures.push(`${p.id}: select failed for ${mv.pieceId}`);
        valid = false;
        break;
      }
      const res = game.handleCellClick(new Hex(mv.to.q, mv.to.r));
      if (!res || (res.action !== "move" && res.action !== "combat")) {
        failures.push(`${p.id}: move to ${mv.to.q},${mv.to.r} illegal`);
        valid = false;
        break;
      }
      // Pawn promotions leave the game in `promotion` state until the piece
      // type is chosen — auto-queen, matching the generator's replay.
      if (game.pendingPromotion) game.completePromotion("queen");
    }
    if (!valid) continue;

    // Final position must be mate. In 3P a checkmate does not necessarily end
    // the game (only elimination to ≤1 faction does), so accept either
    // game_over OR the next side being checkmated — matching the generator's
    // findAllImmediateMatingMoves criterion.
    const mateDelivered =
      (game.state as string) === "game_over" ||
      isCheckmateInternal(game as never, game.currentFaction);
    if (!mateDelivered) {
      failures.push(
        `${p.id}: solution does not end in mate (state=${game.state})`,
      );
      continue;
    }

    // First-move uniqueness
    const clone = reconstructGameFromHash(p.fen)!;
    const mates = findAllImmediateMatingMoves(clone);
    if (!hasUniqueSolution(p)) {
      failures.push(
        `${p.id}: hasUniqueSolution=false (immediate mates=${mates.length})`,
      );
      continue;
    }

    ok++;
  } catch (e) {
    failures.push(`${p.id}: exception ${(e as Error).message}`);
  }
}

console.log(`Validated ${ok}/${data.puzzles.length} puzzles`);
if (failures.length > 0) {
  console.log(`FAILURES (${failures.length}):`);
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log("All puzzles valid.");
