#!/usr/bin/env node
/* eslint-env node */
/**
 * TriSchach Auto-Battle Learning Runner
 * Runs many 3-player AI games to build opening book through self-play learning.
 * Usage: node auto-battle-learn.js [numGames] [aiDepth]
 */

import { Game } from "./js/game.js";
import { generateBoard } from "./js/board.js";
import {
  calculateBestMove,
  setAIDepth,
  setAIPersonality,
} from "./js/ai-core.js";
import { learnFromGame, getLearnedData } from "./js/opening-book.js";
import fs from "fs";

const NUM_GAMES = parseInt(process.argv[2]) || 100;
const AI_DEPTH = parseInt(process.argv[3]) || 4;

const PERSONALITIES = [
  "balanced",
  "aggressive",
  "defensive",
  "positional",
  "tactical",
];

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

async function playAutoBattleGame(_gameNum) {
  const game = new Game();
  game.init(generateBoard());
  game.rpsEnabled = true;

  // Random personality assignment for variety
  const personalities = PERSONALITIES.map(
    () => PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)],
  );
  setAIPersonality(personalities[0]); // Used for all factions - AI picks personality internally per faction
  setAIDepth(AI_DEPTH);

  const gameHistory = [];
  let lastResult = null;
  let moveCount = 0;
  const MAX_MOVES = 300;

  while (game.state !== "game_over" && moveCount < MAX_MOVES) {
    const action = calculateBestMove(game, game.currentFaction);
    if (!action) break;

    // Record ALL moves in opening phase (first 30 plies = 10 per player)
    if (moveCount < 30) {
      gameHistory.push({
        hash: boardHash(game),
        faction: game.currentFaction,
        move: {
          pieceId: action.piece.id,
          targetQ: action.target.q,
          targetR: action.target.r,
        },
      });
    }

    const selResult = game.handleCellClick(action.piece.pos);
    if (selResult?.action === "deselect") break;

    lastResult = game.handleCellClick(action.target);

    if (lastResult && lastResult.promotion && game.pendingPromotion) {
      game.completePromotion("queen");
    }

    moveCount++;
  }

  // Learn from this game
  let winnerFaction = null;
  if (lastResult && lastResult.winner_faction) {
    winnerFaction = lastResult.winner_faction;
  } else if (game.state === "game_over" && moveCount >= MAX_MOVES) {
    winnerFaction = null; // draw
  }

  if (gameHistory.length > 0) {
    learnFromGame(gameHistory, winnerFaction);
  }

  return {
    moves: moveCount,
    winner: winnerFaction,
    historyLength: gameHistory.length,
  };
}

async function main() {
  console.log("=== TriSchach Auto-Battle Learning ===");
  console.log(`Games: ${NUM_GAMES} | AI Depth: ${AI_DEPTH}`);
  console.log(`Personalities: ${PERSONALITIES.join(", ")}\n`);

  // Load existing learned data
  const learnedFile = "opening-book.learned.json";
  if (fs.existsSync(learnedFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(learnedFile, "utf-8"));
      console.log(
        `Loaded existing learned data: ${Object.keys(data.positions || {}).length} positions`,
      );
    } catch {
      console.log("No valid existing learned data");
    }
  }

  const stats = {
    fire: 0,
    water: 0,
    nature: 0,
    draws: 0,
    totalMoves: 0,
    totalHistoryMoves: 0,
  };

  for (let g = 1; g <= NUM_GAMES; g++) {
    const result = await playAutoBattleGame(g);

    if (result.winner) stats[result.winner]++;
    else stats.draws++;
    stats.totalMoves += result.moves;
    stats.totalHistoryMoves += result.historyLength;

    if (g % 10 === 0 || g === NUM_GAMES) {
      const avgMoves = (stats.totalMoves / g).toFixed(1);
      const avgHist = (stats.totalHistoryMoves / g).toFixed(1);
      console.log(
        `Game ${g}/${NUM_GAMES} | F:${stats.fire} W:${stats.water} N:${stats.nature} D:${stats.draws} | AvgMoves:${avgMoves} AvgHist:${avgHist}`,
      );
    }

    // Save learned data periodically
    if (g % 25 === 0) {
      const learnedData = getLearnedData();
      const output = {
        version: 1,
        updated: new Date().toISOString(),
        positions: learnedData,
      };
      fs.writeFileSync(learnedFile, JSON.stringify(output, null, 2));
      console.log(
        `  💾 Saved learned data: ${Object.keys(learnedData).length} positions`,
      );
    }
  }

  // Final save
  const learnedData = getLearnedData();
  const output = {
    version: 1,
    updated: new Date().toISOString(),
    positions: learnedData,
  };
  fs.writeFileSync(learnedFile, JSON.stringify(output, null, 2));

  console.log("\n=== Final Statistics ===");
  console.log(`Fire wins: ${stats.fire}`);
  console.log(`Water wins: ${stats.water}`);
  console.log(`Nature wins: ${stats.nature}`);
  console.log(`Draws: ${stats.draws}`);
  console.log(
    `Avg game length: ${(stats.totalMoves / NUM_GAMES).toFixed(1)} moves`,
  );
  console.log(
    `Avg opening moves recorded: ${(stats.totalHistoryMoves / NUM_GAMES).toFixed(1)}`,
  );
  console.log(`Total learned positions: ${Object.keys(learnedData).length}`);
  console.log(`\n💾 Saved to ${learnedFile}`);

  // Also update compiled book with learned data
  console.log("\nRegenerating compiled book with learned weights...");
  const { execSync } = await import("child_process");
  execSync("node generate-deep-opening-book.js", { stdio: "inherit" });
}

main().catch(console.error);
