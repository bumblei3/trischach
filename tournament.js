#!/usr/bin/env node
/* eslint-env node */
/**
 * TriSchach Engine vs Engine Tournament
 *
 * Runs AI personalities against each other and computes Elo ratings.
 * Usage: node tournament.js [games_per_pairing] [depth]
 */

import { Game } from "./js/game.js";
import { generateBoard } from "./js/board.js";
import {
  calculateBestMove,
  setAIDepth,
  setAIPersonality,
  getAIPersonalities,
  learnFromGame,
} from "./js/ai.js";

const GAMES_PER_PAIRING = parseInt(process.argv[2]) || 10;
const AI_DEPTH = parseInt(process.argv[3]) || 3;

const personalities = getAIPersonalities().map((p) => p.key);
const engines = [...personalities, "random"];

console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║           TriSchach Engine Tournament                        ║");
console.log("╠══════════════════════════════════════════════════════════════╣");
console.log(`║  Engines: ${engines.join(", ").padEnd(50)} ║`);
console.log(
  `║  Depth: ${AI_DEPTH} | Games per pairing: ${GAMES_PER_PAIRING}`.padEnd(61) +
    "║",
);
console.log(
  "╚══════════════════════════════════════════════════════════════╝\n",
);

const K_FACTOR = 32;
const INITIAL_ELO = 1200;

// Board hash function for opening book
function boardHash(game) {
  const pieces = game.pieces
    .filter((p) => p.alive)
    .map((p) => `${p.faction[0]}${p.type[0]}${p.pos.q},${p.pos.r}`)
    .sort()
    .join("|");
  return `${pieces}#${game.currentFactionIdx !== undefined ? game.currentFactionIdx : ["fire", "water", "nature"].indexOf(game.currentFaction)}`;
}

const eloRatings = {};
const results = {};

engines.forEach((e) => {
  eloRatings[e] = INITIAL_ELO;
  results[e] = {};
  engines.forEach((f) => {
    if (e !== f) results[e][f] = { wins: 0, draws: 0, losses: 0 };
  });
});

function expectedScore(eloA, eloB) {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

function updateElo(engineA, engineB, scoreA) {
  const eA = expectedScore(eloRatings[engineA], eloRatings[engineB]);
  const eB = expectedScore(eloRatings[engineB], eloRatings[engineA]);
  eloRatings[engineA] += Math.round(K_FACTOR * (scoreA - eA));
  eloRatings[engineB] += Math.round(K_FACTOR * (1 - scoreA - eB));
}

async function playGame(engineA, engineB, gameNum, totalGames) {
  const game = new Game();
  game.init(generateBoard());
  game.rpsEnabled = true;

  if (engineA !== "random") setAIPersonality(engineA);
  if (engineB !== "random") setAIPersonality(engineB);
  setAIDepth(AI_DEPTH);

  // Remove Nature faction to make it true 2-player
  game.eliminatedFactions.add("nature");
  for (const p of game.pieces) {
    if (p.faction === "nature") p.alive = false;
  }

  const factionToEngine = {
    fire: engineA,
    water: engineB,
    nature: "balanced",
  };

  // Track game history for opening book learning
  const gameHistory = [];

  let lastResult = null;
  let moveCount = 0;
  const maxMoves = 200;

  process.stdout.write(
    `\r  Game ${gameNum}/${totalGames}: ${engineA} vs ${engineB} | Move ${moveCount}   `,
  );

  while (game.state !== "game_over" && moveCount < maxMoves) {
    const currentEngine = factionToEngine[game.currentFaction];

    let action;
    if (currentEngine === "random") {
      const actions = game.pieces
        .filter((p) => p.faction === game.currentFaction && p.alive)
        .flatMap((p) => {
          const { moves, attacks } = game.getLegalMoves(p);
          return [
            ...moves.map((t) => ({ piece: p, target: t, type: "move" })),
            ...attacks.map((t) => ({ piece: p, target: t, type: "attack" })),
          ];
        });
      if (actions.length === 0) break;
      action = actions[Math.floor(Math.random() * actions.length)];
    } else {
      action = calculateBestMove(game, game.currentFaction);
      if (!action) break;
    }

    // Record move for learning (only for opening phase - first 20 moves total)
    if (moveCount < 20) {
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
    if (selResult.action === "deselect") break;

    lastResult = game.handleCellClick(action.target);

    if (lastResult && lastResult.promotion && game.pendingPromotion) {
      game.completePromotion("queen");
    }

    moveCount++;
    if (moveCount % 30 === 0) {
      process.stdout.write(
        `\r  Game ${gameNum}/${totalGames}: ${engineA} vs ${engineB} | Move ${moveCount}   `,
      );
    }
  }

  // Learn from this game
  let winnerFaction = null;
  if (lastResult && lastResult.winner_faction) {
    winnerFaction = lastResult.winner_faction;
  } else if (game.state === "game_over" && moveCount >= maxMoves) {
    // Draw by max moves
    winnerFaction = null;
  }

  if (gameHistory.length > 0) {
    learnFromGame(gameHistory, winnerFaction);
  }

  // Determine result from lastResult.winner_faction
  let scoreA = 0.5;
  if (lastResult && lastResult.winner_faction) {
    const winnerEngine = factionToEngine[lastResult.winner_faction];
    if (winnerEngine === engineA) scoreA = 1;
    else if (winnerEngine === engineB) scoreA = 0;
    else scoreA = 0.5;
  } else if (game.state !== "game_over" && moveCount >= maxMoves) {
    const pieces = game.pieces.filter((p) => p.alive);
    const aMaterial = pieces.filter(
      (p) => factionToEngine[p.faction] === engineA,
    ).length;
    const bMaterial = pieces.filter(
      (p) => factionToEngine[p.faction] === engineB,
    ).length;
    const balancedMaterial = pieces.filter(
      (p) => factionToEngine[p.faction] === "balanced",
    ).length;

    if (aMaterial > bMaterial && aMaterial > balancedMaterial) scoreA = 1;
    else if (bMaterial > aMaterial && bMaterial > balancedMaterial) scoreA = 0;
    else scoreA = 0.5;
  }

  return {
    scoreA,
    moves: moveCount,
    winner: lastResult?.winner_faction || null,
  };
}

async function runTournament() {
  console.log("\n🏁 Starting tournament...\n");

  const pairings = [];
  for (let i = 0; i < engines.length; i++) {
    for (let j = i + 1; j < engines.length; j++) {
      pairings.push([engines[i], engines[j]]);
    }
  }

  let completed = 0;
  const totalGames = pairings.length * GAMES_PER_PAIRING * 2;

  for (const [engineA, engineB] of pairings) {
    console.log(`\n📊 Pairing: ${engineA} vs ${engineB}`);

    // Play as first player (Fire)
    for (let g = 0; g < GAMES_PER_PAIRING; g++) {
      completed++;
      const result = await playGame(engineA, engineB, completed, totalGames);

      if (result.scoreA === 1) {
        results[engineA][engineB].wins++;
        results[engineB][engineA].losses++;
      } else if (result.scoreA === 0) {
        results[engineA][engineB].losses++;
        results[engineB][engineA].wins++;
      } else {
        results[engineA][engineB].draws++;
        results[engineB][engineA].draws++;
      }
      updateElo(engineA, engineB, result.scoreA);
    }

    // Play as second player (Water)
    for (let g = 0; g < GAMES_PER_PAIRING; g++) {
      completed++;
      const result = await playGame(engineB, engineA, completed, totalGames);

      if (result.scoreA === 1) {
        results[engineB][engineA].wins++;
        results[engineA][engineB].losses++;
      } else if (result.scoreA === 0) {
        results[engineB][engineA].losses++;
        results[engineA][engineB].wins++;
      } else {
        results[engineB][engineA].draws++;
        results[engineA][engineB].draws++;
      }
      updateElo(engineB, engineA, result.scoreA);
    }

    const aStats = results[engineA][engineB];
    const bStats = results[engineB][engineA];
    console.log(
      `   ${engineA}: ${aStats.wins}W ${aStats.draws}D ${aStats.losses}L | Elo: ${eloRatings[engineA]}`,
    );
    console.log(
      `   ${engineB}: ${bStats.wins}W ${bStats.draws}D ${bStats.losses}L | Elo: ${eloRatings[engineB]}`,
    );
  }

  // Final standings
  console.log(
    "\n══════════════════════════════════════════════════════════════",
  );
  console.log("🏆 TOURNAMENT RESULTS - FINAL STANDINGS");
  console.log("══════════════════════════════════════════════════════════════");

  const sorted = engines.sort((a, b) => eloRatings[b] - eloRatings[a]);

  console.log(
    "\nRank | Engine          | Elo  | Δ    | W   | D   | L   | Games",
  );
  console.log("-----|-----------------|------|------|-----|-----|-----|------");

  sorted.forEach((engine, idx) => {
    let totalW = 0,
      totalD = 0,
      totalL = 0,
      totalG = 0;
    engines.forEach((op) => {
      if (results[engine][op]) {
        totalW += results[engine][op].wins;
        totalD += results[engine][op].draws;
        totalL += results[engine][op].losses;
        totalG +=
          results[engine][op].wins +
          results[engine][op].draws +
          results[engine][op].losses;
      }
    });
    const delta = eloRatings[engine] - INITIAL_ELO;
    const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
    console.log(
      `${String(idx + 1).padStart(4)} | ${engine.padEnd(15)} | ${String(eloRatings[engine]).padStart(4)} | ${deltaStr.padStart(4)} | ${String(totalW).padStart(3)} | ${String(totalD).padStart(3)} | ${String(totalL).padStart(3)} | ${String(totalG).padStart(5)}`,
    );
  });

  // Cross table
  console.log("\n📋 CROSS TABLE (Row vs Column - % score):");
  console.log(
    "Engine".padEnd(15),
    engines.map((e) => e.substring(0, 4)).join("  "),
  );
  engines.forEach((engineA) => {
    let row = engineA.padEnd(15);
    engines.forEach((engineB) => {
      if (engineA === engineB) {
        row += "  —  ";
      } else {
        const r = results[engineA][engineB];
        const score = r.wins * 1 + r.draws * 0.5;
        const total = r.wins + r.draws + r.losses;
        const pct = total > 0 ? Math.round((score / total) * 100) : 0;
        row += `${String(pct).padStart(3)}% `;
      }
    });
    console.log(row);
  });

  // Save results
  const fs = await import("fs");
  const resultData = {
    timestamp: new Date().toISOString(),
    config: { GAMES_PER_PAIRING, AI_DEPTH },
    engines,
    elo: eloRatings,
    results,
  };
  fs.writeFileSync(
    "tournament-results.json",
    JSON.stringify(resultData, null, 2),
  );
  console.log("\n💾 Results saved to tournament-results.json");

  // Save learned opening book data
  const { getLearnedData } = await import("./js/ai.js");
  const learnedData = getLearnedData();
  if (Object.keys(learnedData).length > 0) {
    const learnedOutput = {
      version: 1,
      updated: new Date().toISOString(),
      positions: learnedData,
    };
    fs.writeFileSync(
      "opening-book.learned.json",
      JSON.stringify(learnedOutput, null, 2),
    );
    console.log(
      `💾 Learned opening book data saved (${Object.keys(learnedData).length} positions)`,
    );
  } else {
    console.log("💾 No new learned opening book data to save");
  }
}

runTournament().catch(console.error);
