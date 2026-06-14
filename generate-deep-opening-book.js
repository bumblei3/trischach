#!/usr/bin/env node
/**
 * TriSchach Deep Opening Book Generator
 *
 * Generates opening book by self-play exploration + weighted learning.
 * Extends depth to ~25 ply by running many games and extracting
 * the most successful lines per position.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateBoard } from "./js/board.js";
import { Hex } from "./js/hex.js";
import { Game } from "./js/game.js";
import { calculateBestMove, setAIDepth } from "./js/ai-core.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_JSON = path.join(__dirname, "opening-book.json");
const OUTPUT_JSON = path.join(__dirname, "opening-book.compiled.json");
const LEARNED_JSON = path.join(__dirname, "opening-book.learned.json");

// ─── Configuration ──────────────────────────────────────────────
const CONFIG = {
  targetDepth: 25, // Target ply depth
  gamesPerPosition: 50, // Self-play games to explore each position
  minWeight: 10, // Minimum weight for learned moves
  weightDecay: 0.95, // Weight decay per ply
  winBonus: 1.5, // Weight multiplier for winning lines
  drawMultiplier: 1.1, // Weight multiplier for draws
  lossPenalty: 0.7, // Weight multiplier for losing lines
  explorationEpsilon: 0.1, // Random move probability for exploration
  aiDepth: 4, // AI search depth for self-play
};

// ─── Helpers ─────────────────────────────────────────────────────
function boardHash(game) {
  const pieces = game
    .getAlivePieces()
    .filter((p) => p.alive)
    .map((p) => `${p.faction[0]}${p.type[0]}${p.pos.q},${p.pos.r}`)
    .sort()
    .join("|");
  return `${pieces}#${game.currentFactionIdx}`;
}

function cloneGame(game) {
  const newGame = new Game();
  newGame.boardCells = new Map(game.boardCells);
  newGame.pieces = game.pieces.map((p) => ({ ...p }));
  newGame.currentFaction = game.currentFaction;
  newGame.currentFactionIdx = game.currentFactionIdx;
  newGame.state = game.state;
  newGame.winner = game.winner;
  newGame.rpsEnabled = game.rpsEnabled;
  newGame.eliminatedFactions = new Set(game.eliminatedFactions);
  newGame.capturedPieces = { ...game.capturedPieces };
  newGame._rebuildOccupiedMap();
  return newGame;
}

function loadSource() {
  const raw = fs.readFileSync(SOURCE_JSON, "utf-8");
  return JSON.parse(raw);
}

function loadLearned() {
  if (fs.existsSync(LEARNED_JSON)) {
    try {
      const raw = fs.readFileSync(LEARNED_JSON, "utf-8");
      return JSON.parse(raw);
    } catch {
      return { positions: {}, version: 1 };
    }
  }
  return { positions: {}, version: 1 };
}

function saveLearned(data) {
  fs.writeFileSync(LEARNED_JSON, JSON.stringify(data, null, 2));
}

// ─── Self-Play Exploration ───────────────────────────────────────
/**
 * Run a single self-play game from the given position.
 * Returns the sequence of moves played and the result from perspective of each faction.
 */
function playGameFromPosition(initialGame, maxPly = CONFIG.targetDepth) {
  const game = cloneGame(initialGame);
  const moveHistory = [];
  let ply = 0;

  while (ply < maxPly && game.state !== "game_over") {
    const hash = boardHash(game);
    const actions = game.getAllActions
      ? game.getAllActions(game.currentFaction)
      : [];

    if (actions.length === 0) break;

    // Epsilon-greedy: small chance of random move for exploration
    let move;
    if (Math.random() < CONFIG.explorationEpsilon) {
      move = actions[Math.floor(Math.random() * actions.length)];
    } else {
      move = calculateBestMove(game, game.currentFaction);
    }

    if (!move) break;

    moveHistory.push({
      hash,
      faction: game.currentFaction,
      move: {
        pieceId: move.piece.id,
        targetQ: move.target.q,
        targetR: move.target.r,
      },
    });

    // Make the move
    const selectResult = game.handleCellClick(move.piece.pos);
    if (selectResult && selectResult.action === "select") {
      const result = game.handleCellClick(move.target);
      if (result && result.promotion) {
        game.completePromotion("queen");
      }
    }

    ply++;
  }

  // Determine results for each faction
  const results = { fire: 0, water: 0, nature: 0 }; // 1=win, 0=draw, -1=loss
  if (game.state === "game_over" && game.winner) {
    for (const f of ["fire", "water", "nature"]) {
      results[f] = f === game.winner ? 1 : -1;
    }
  }

  return { moveHistory, results, finalState: game.state };
}

/**
 * Explore a position by running many games and collecting statistics.
 */
function explorePosition(game, book, learnedData, depth = 0) {
  if (depth >= CONFIG.targetDepth || game.state === "game_over") return;

  const hash = boardHash(game);

  // Initialize position in book if not present
  if (!book.has(hash)) {
    book.set(hash, []);
  }

  // Merge learned weights
  if (learnedData.positions[hash]) {
    for (const learnedVar of learnedData.positions[hash]) {
      const variations = book.get(hash);
      if (!variations) continue;
      const existing = variations.find(
        (v) =>
          v.move.pieceId === learnedVar.move.pieceId &&
          v.move.targetQ === learnedVar.move.targetQ &&
          v.move.targetR === learnedVar.move.targetR,
      );
      if (existing) {
        existing.weight = Math.max(
          existing.weight,
          learnedVar.wins + learnedVar.draws * 0.5,
        );
        existing.wins = learnedVar.wins;
        existing.draws = learnedVar.draws;
        existing.losses = learnedVar.losses;
        existing.visits = learnedVar.visits;
      } else {
        variations.push({
          move: learnedVar.move,
          weight: learnedVar.wins + learnedVar.draws * 0.5,
          wins: learnedVar.wins,
          draws: learnedVar.draws,
          losses: learnedVar.losses,
          visits: learnedVar.visits,
        });
      }
    }
  }

  // Run self-play games from this position
  console.log(
    `  Exploring depth ${depth} (${book.get(hash)?.length || 0} variations)...`,
  );

  for (let g = 0; g < CONFIG.gamesPerPosition; g++) {
    const { moveHistory, results } = playGameFromPosition(game);

    // Update weights based on results
    for (const entry of moveHistory) {
      const variations = book.get(entry.hash);
      if (!variations) continue;
      const variation = variations.find(
        (v) =>
          v.move.pieceId === entry.move.pieceId &&
          v.move.targetQ === entry.move.targetQ &&
          v.move.targetR === entry.move.targetR,
      );

      if (variation) {
        variation.visits++;
        const result = results[entry.faction];
        if (result === 1) {
          variation.wins++;
          variation.weight *= CONFIG.winBonus;
        } else if (result === 0) {
          variation.draws++;
          variation.weight *= CONFIG.drawMultiplier;
        } else {
          variation.losses++;
          variation.weight *= CONFIG.lossPenalty;
        }
        // Apply decay based on ply depth
        variation.weight *= Math.pow(CONFIG.weightDecay, depth);
        variation.weight = Math.max(variation.weight, CONFIG.minWeight);
      }
    }
  }

  // Sort variations by weight
  const variations2 = book.get(hash);
  if (variations2) {
    variations2.sort((a, b) => b.weight - a.weight);
  }
}

// ─── Main Generation ─────────────────────────────────────────────
async function main() {
  console.log("=== TriSchach Deep Opening Book Generator ===");
  console.log(`Target depth: ${CONFIG.targetDepth} ply`);
  console.log(`Games per position: ${CONFIG.gamesPerPosition}`);
  console.log(`AI depth: ${CONFIG.aiDepth}`);

  // Load source lines
  const source = loadSource();
  console.log(`\nLoaded source: ${Object.keys(source.lines).length} factions`);

  // Load existing learned data
  const learnedData = loadLearned();
  console.log(
    `Loaded learned data: ${Object.keys(learnedData.positions).length} positions`,
  );

  // Set AI depth for self-play
  setAIDepth(CONFIG.aiDepth);

  // Build initial book from source using existing generator
  console.log("\nGenerating base book from source...");
  const { execSync } = await import("child_process");
  execSync("node generate-opening-book.js", {
    cwd: __dirname,
    stdio: "inherit",
  });

  // Load the compiled book
  const compiledData = JSON.parse(fs.readFileSync(OUTPUT_JSON, "utf-8"));

  const book = new Map();
  for (const [hash, variations] of Object.entries(compiledData.book)) {
    book.set(
      hash,
      variations.map((v) => ({
        move: v.move,
        weight: v.weight,
        wins: 0,
        draws: 0,
        losses: 0,
        visits: 0,
      })),
    );
  }

  console.log(`Base book: ${book.size} positions`);

  // Now self-play exploration from root position
  console.log("\nStarting self-play exploration...");
  const game = new Game();
  const cells = generateBoard();
  game.init(cells);

  // Breadth-first exploration up to target depth
  const positionsToExplore = [game];

  for (
    let depth = 0;
    depth < CONFIG.targetDepth && positionsToExplore.length > 0;
    depth++
  ) {
    console.log(
      `\n--- Depth ${depth}: ${positionsToExplore.length} positions ---`,
    );
    const nextPositions = [];

    for (const pos of positionsToExplore) {
      explorePosition(pos, book, learnedData, depth);

      // Get best moves from this position to explore further
      const hash = boardHash(pos);
      const variations = book.get(hash);
      if (variations && variations.length > 0) {
        // Take top 3 moves for next depth
        for (const v of variations.slice(0, 3)) {
          const newGame = cloneGame(pos);
          const piece = newGame.pieces.find(
            (p) => p.id === v.move.pieceId && p.alive,
          );
          if (piece) {
            const selectResult = newGame.handleCellClick(piece.pos);
            if (selectResult && selectResult.action === "select") {
              const targetHex = new Hex(v.move.targetQ, v.move.targetR);
              const result = newGame.handleCellClick(targetHex);
              if (
                result &&
                (result.action === "move" || result.action === "combat")
              ) {
                if (result.promotion) newGame.completePromotion("queen");
                nextPositions.push(newGame);
              }
            }
          }
        }
      }
    }

    positionsToExplore.length = 0;
    positionsToExplore.push(...nextPositions);

    // Deduplicate by hash
    const seen = new Set();
    const unique = [];
    for (const p of positionsToExplore) {
      const h = boardHash(p);
      if (!seen.has(h)) {
        seen.add(h);
        unique.push(p);
      }
    }
    positionsToExplore.length = 0;
    positionsToExplore.push(...unique.slice(0, 50)); // Cap at 50 positions per depth
  }

  // Update learned data with new statistics
  console.log("\nUpdating learned data...");
  for (const [hash, variations] of book.entries()) {
    if (!learnedData.positions[hash]) learnedData.positions[hash] = [];
    for (const v of variations) {
      if (v.visits > 0) {
        const existing = learnedData.positions[hash].find(
          (lv) =>
            lv.move.pieceId === v.move.pieceId &&
            lv.move.targetQ === v.move.targetQ &&
            lv.move.targetR === v.move.targetR,
        );
        if (existing) {
          existing.wins = v.wins;
          existing.draws = v.draws;
          existing.losses = v.losses;
          existing.visits = v.visits;
        } else {
          learnedData.positions[hash].push({
            ...v.move,
            wins: v.wins,
            draws: v.draws,
            losses: v.losses,
            visits: v.visits,
          });
        }
      }
    }
  }

  saveLearned(learnedData);
  console.log(
    `Learned data saved: ${Object.keys(learnedData.positions).length} positions`,
  );

  // Save final compiled book
  const bookObj = {};
  for (const [hash, variations] of book.entries()) {
    bookObj[hash] = variations.map((v) => ({
      move: v.move,
      weight: Math.round(v.weight),
    }));
  }

  const output = {
    version: source.version,
    metadata: {
      ...source.metadata,
      compiled: new Date().toISOString(),
      stats: {
        totalPositions: book.size,
        totalVariations: Array.from(book.values()).reduce(
          (sum, arr) => sum + arr.length,
          0,
        ),
        maxDepth: CONFIG.targetDepth,
      },
    },
    book: bookObj,
  };

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2));
  console.log(`\n✅ Deep opening book saved to ${OUTPUT_JSON}`);
  console.log(`   Positions: ${book.size}`);
  console.log(`   Target depth: ${CONFIG.targetDepth} ply`);
}

// Run if main module
if (import.meta.url.includes("generate-deep-opening-book")) {
  main().catch(console.error);
}

export {
  playGameFromPosition,
  explorePosition,
  CONFIG,
  loadLearned,
  saveLearned,
};
