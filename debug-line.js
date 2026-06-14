#!/usr/bin/env node
/**
 * Debug a specific opening line by replaying it step by step
 */

import { Game } from "./js/game.js";
import { generateBoard } from "./js/board.js";
import fs from "fs";

const source = JSON.parse(fs.readFileSync("opening-book.json", "utf-8"));
const line = source.lines.fire.Main; // Fire Main line
const moves = line.moves;

console.log(`=== Debugging: ${line.name} (${moves.length} moves) ===`);

const game = new Game();
game.init(generateBoard());

for (let i = 0; i < moves.length; i++) {
  const moveStr = moves[i];
  const [piecePart, targetPart] = moveStr.split("->").map((s) => s.trim());
  const piece = game.pieces.find((p) => p.id === piecePart);
  const [q, r] = targetPart.split(",").map(Number);

  console.log(`\nPly ${i}: ${game.currentFaction} to move`);
  console.log(`  Move: ${piecePart} -> ${q},${r}`);

  if (!piece) {
    console.log(`  ❌ Piece ${piecePart} NOT FOUND!`);
    // List all alive pieces of current faction
    const alive = game.pieces.filter(
      (p) => p.faction === game.currentFaction && p.alive,
    );
    console.log(
      `  Alive ${game.currentFaction} pieces:`,
      alive.map((p) => p.id),
    );
    break;
  }

  if (!piece.alive) {
    console.log(`  ❌ Piece ${piecePart} is DEAD!`);
    break;
  }

  console.log(`  Piece at: ${piece.pos.key}`);

  // Check valid moves
  const validMoves = game.getLegalMoves
    ? game.getLegalMoves(piece)
    : { moves: [], attacks: [] };
  const allTargets = [...validMoves.moves, ...validMoves.attacks].map(
    (h) => h.key,
  );
  const targetKey = new (await import("./js/hex.js")).Hex(q, r).key;

  if (!allTargets.includes(targetKey)) {
    console.log(`  ❌ Move INVALID! Valid targets: ${allTargets.join(", ")}`);
    break;
  }

  console.log(`  ✓ Valid`);

  // Make the move
  const selResult = game.handleCellClick(piece.pos);
  if (!selResult || selResult.action !== "select") {
    console.log(`  ❌ Select failed:`, selResult);
    break;
  }

  const result = game.handleCellClick(
    new (await import("./js/hex.js")).Hex(q, r),
  );
  console.log(`  Result:`, result);

  if (result && result.promotion && game.pendingPromotion) {
    game.completePromotion("queen");
    console.log(`  Promoted to queen`);
  }
}

console.log("\n=== Done ===");
