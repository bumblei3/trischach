#!/usr/bin/env node
/**
 * Generate valid opening lines by AI self-play from root position.
 * Outputs JSON lines for opening-book.json
 */

import { Game } from "./js/game.js";
import { generateBoard } from "./js/board.js";
import {
  calculateBestMove,
  setAIDepth,
  setAIPersonality,
  getAIPersonalities,
} from "./js/ai-core.js";

const PERSONALITIES = getAIPersonalities().map((p) => p.key);
const AI_DEPTH = 5;

function boardHash(game) {
  const pieces = game.pieces
    .filter((p) => p.alive)
    .map((p) => `${p.faction[0]}${p.type[0]}${p.pos.q},${p.pos.r}`)
    .sort()
    .join("|");
  const factionIdx =
    game.currentFactionIdx !== undefined
      ? game.currentFactionIdx
      : ["fire", "water", "nature"].indexOf(game.currentFaction);
  return `${pieces}#${factionIdx}`;
}

function playLine(personality, maxPly = 30) {
  const game = new Game();
  game.init(generateBoard());
  game.rpsEnabled = true;
  setAIPersonality(personality);
  setAIDepth(AI_DEPTH);

  const moves = [];
  let moveCount = 0;

  while (moveCount < maxPly && game.state !== "game_over") {
    const action = calculateBestMove(game, game.currentFaction);
    if (!action) break;

    // Record move in readable format
    const hash = boardHash(game);
    moves.push({
      hash,
      faction: game.currentFaction,
      pieceId: action.piece.id,
      targetQ: action.target.q,
      targetR: action.target.r,
      moveStr: `${action.piece.id} -> ${action.target.q},${action.target.r}`,
    });

    const selResult = game.handleCellClick(action.piece.pos);
    if (!selResult || selResult.action !== "select") break;

    const result = game.handleCellClick(action.target);
    if (result && result.promotion && game.pendingPromotion) {
      game.completePromotion("queen");
    }

    moveCount++;
  }

  return moves;
}

async function main() {
  console.log("=== Generating AI Opening Lines ===");
  console.log(`Personalities: ${PERSONALITIES.join(", ")}`);
  console.log(`AI Depth: ${AI_DEPTH}\n`);

  const allLines = {};

  for (const personality of PERSONALITIES) {
    console.log(`\n--- Personality: ${personality} ---`);
    const moves = playLine(personality, 30);

    // Group by faction
    const byFaction = { fire: [], water: [], nature: [] };
    for (const m of moves) {
      byFaction[m.faction].push(m.moveStr);
    }

    console.log(
      `  Fire (${byFaction.fire.length}):`,
      byFaction.fire.slice(0, 10).join(", "),
    );
    console.log(
      `  Water (${byFaction.water.length}):`,
      byFaction.water.slice(0, 10).join(", "),
    );
    console.log(
      `  Nature (${byFaction.nature.length}):`,
      byFaction.nature.slice(0, 10).join(", "),
    );

    allLines[personality] = byFaction;
  }

  // Also generate some "consensus" lines by picking best move at each position
  console.log("\n--- Consensus (Best Move Each Turn) ---");
  const game = new Game();
  game.init(generateBoard());
  game.rpsEnabled = true;
  setAIPersonality("balanced");
  setAIDepth(AI_DEPTH);

  const consensusMoves = [];
  for (let i = 0; i < 30 && game.state !== "game_over"; i++) {
    const action = calculateBestMove(game, game.currentFaction);
    if (!action) break;
    consensusMoves.push({
      faction: game.currentFaction,
      moveStr: `${action.piece.id} -> ${action.target.q},${action.target.r}`,
    });
    const selResult = game.handleCellClick(action.piece.pos);
    if (!selResult || selResult.action !== "select") break;
    const result = game.handleCellClick(action.target);
    if (result && result.promotion && game.pendingPromotion) {
      game.completePromotion("queen");
    }
  }

  console.log(
    "Consensus moves:",
    consensusMoves.map((m) => `${m.faction}: ${m.moveStr}`).join(" | "),
  );

  console.log("\n=== Done ===");
  console.log("Use these moves to update opening-book.json manually,");
  console.log("or extend this script to output JSON directly.");
}

main().catch(console.error);
