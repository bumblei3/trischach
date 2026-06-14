#!/usr/bin/env node
/**
 * Puzzle Generator for TriSchach
 * Generates "Mate in N" puzzles by running the full AI engine on endgame positions
 */

import { Game } from "./js/game.js";
import { generateBoard } from "./js/board.js";
import {
  setAIDepth,
  setAIPersonality,
  iterativeDeepening,
  isKingdomCheck,
  getAllActions,
} from "./js/ai.js";
import { Hex } from "./js/hex.js";
import { FACTION } from "./js/board.js";
import fs from "fs";
import path from "path";

const PUZZLE_CONFIG = {
  aiDepth: 8,
  aiPersonality: "tactical",
  outputFile: path.resolve("./puzzles.json"),
  maxPuzzlesPerType: 10,
};

function createGameFromPosition(posData) {
  const game = new Game();
  game.init(generateBoard());
  game.rpsEnabled = true;
  game.pieces = posData.pieces.map((p) => ({
    ...p,
    pos: p.pos instanceof Hex ? p.pos : new Hex(p.pos.q, p.pos.r),
  }));
  game.currentFaction = posData.currentFaction;
  game.currentFactionIdx = [
    FACTION.FIRE,
    FACTION.WATER,
    FACTION.NATURE,
  ].indexOf(posData.currentFaction);
  game.eliminatedFactions = new Set(posData.eliminated);
  game.state = "select_piece";
  game._rebuildOccupiedMap();
  return game;
}

function exportPositionToFEN(posData) {
  const pieces = posData.pieces
    .map((p) => {
      const pieceChar = p.faction[0].toUpperCase() + p.type[0].toUpperCase();
      return `${pieceChar}@${p.pos.q},${p.pos.r}`;
    })
    .join(";");
  return `TSPN:${pieces}#${posData.currentFaction}`;
}

async function findForcedMate(game, maxDepth) {
  for (let depth = 1; depth <= maxDepth; depth++) {
    setAIDepth(depth);
    const move = iterativeDeepening(game, game.currentFaction);
    if (!move) continue;
    const testGame = cloneGame(game);
    const selectResult = testGame.handleCellClick(move.piece.pos);
    if (!selectResult || selectResult.action !== "select") continue;
    const moveResult = testGame.handleCellClick(move.target);
    if (moveResult && moveResult.checkmate)
      return { depth, move, checkmate: true };
    if (moveResult && moveResult.action === "move") {
      const opponentInCheck = isKingdomCheck(testGame, testGame.currentFaction);
      const oppActions = getAllActions(testGame, testGame.currentFaction);
      if (opponentInCheck && oppActions.length === 0)
        return { depth, move, checkmate: true };
    }
  }
  return null;
}

function cloneGame(source) {
  const game = new Game();
  game.init(generateBoard());
  game.rpsEnabled = true;
  game.pieces = source.pieces.map((p) => ({
    ...p,
    pos: new Hex(p.pos.q, p.pos.r),
  }));
  game.currentFaction = source.currentFaction;
  game.currentFactionIdx = source.currentFactionIdx;
  game.eliminatedFactions = new Set(source.eliminatedFactions);
  game.state = source.state;
  game._halfmoveClock = source._halfmoveClock || 0;
  game.capturedPieces = { ...source.capturedPieces };
  game._rebuildOccupiedMap();
  return game;
}

function getBasePositions() {
  return [
    {
      name: "Mate in 1: Queen checkmate",
      pieces: [
        {
          id: "fire_king",
          type: "king",
          faction: "fire",
          pos: new Hex(0, 0),
          symbol: "♚",
          alive: true,
          hasMoved: false,
        },
        {
          id: "fire_queen",
          type: "queen",
          faction: "fire",
          pos: new Hex(0, -1),
          symbol: "♛",
          alive: true,
          hasMoved: false,
        },
        {
          id: "water_king",
          type: "king",
          faction: "water",
          pos: new Hex(-2, 3),
          symbol: "♔",
          alive: true,
          hasMoved: false,
        },
      ],
      currentFaction: "fire",
      eliminated: ["nature"],
      expectedMateIn: 1,
    },
    {
      name: "Mate in 1: Rook checkmate",
      pieces: [
        {
          id: "fire_king",
          type: "king",
          faction: "fire",
          pos: new Hex(0, 0),
          symbol: "♚",
          alive: true,
          hasMoved: false,
        },
        {
          id: "fire_rook",
          type: "rook",
          faction: "fire",
          pos: new Hex(-3, 0),
          symbol: "♜",
          alive: true,
          hasMoved: false,
        },
        {
          id: "water_king",
          type: "king",
          faction: "water",
          pos: new Hex(-2, 0),
          symbol: "♔",
          alive: true,
          hasMoved: false,
        },
      ],
      currentFaction: "fire",
      eliminated: ["nature"],
      expectedMateIn: 1,
    },
    {
      name: "Mate in 2: Queen forces mate",
      pieces: [
        {
          id: "fire_king",
          type: "king",
          faction: "fire",
          pos: new Hex(0, -1),
          symbol: "♚",
          alive: true,
          hasMoved: false,
        },
        {
          id: "fire_queen",
          type: "queen",
          faction: "fire",
          pos: new Hex(-2, 0),
          symbol: "♛",
          alive: true,
          hasMoved: false,
        },
        {
          id: "water_king",
          type: "king",
          faction: "water",
          pos: new Hex(2, -2),
          symbol: "♔",
          alive: true,
          hasMoved: false,
        },
      ],
      currentFaction: "fire",
      eliminated: ["nature"],
      expectedMateIn: 2,
    },
    {
      name: "Mate in 3: Rook forces mate",
      pieces: [
        {
          id: "fire_king",
          type: "king",
          faction: "fire",
          pos: new Hex(0, 0),
          symbol: "♚",
          alive: true,
          hasMoved: false,
        },
        {
          id: "fire_rook",
          type: "rook",
          faction: "fire",
          pos: new Hex(0, -3),
          symbol: "♜",
          alive: true,
          hasMoved: false,
        },
        {
          id: "water_king",
          type: "king",
          faction: "water",
          pos: new Hex(-5, 5),
          symbol: "♔",
          alive: true,
          hasMoved: false,
        },
      ],
      currentFaction: "fire",
      eliminated: ["nature"],
      expectedMateIn: 3,
    },
    {
      name: "Mate in 4: Two Bishops force mate",
      pieces: [
        {
          id: "fire_king",
          type: "king",
          faction: "fire",
          pos: new Hex(0, -1),
          symbol: "♚",
          alive: true,
          hasMoved: false,
        },
        {
          id: "fire_bishop1",
          type: "bishop",
          faction: "fire",
          pos: new Hex(1, -2),
          symbol: "♝",
          alive: true,
          hasMoved: false,
        },
        {
          id: "fire_bishop2",
          type: "bishop",
          faction: "fire",
          pos: new Hex(-1, -2),
          symbol: "♝",
          alive: true,
          hasMoved: false,
        },
        {
          id: "water_king",
          type: "king",
          faction: "water",
          pos: new Hex(-3, 3),
          symbol: "♔",
          alive: true,
          hasMoved: false,
        },
      ],
      currentFaction: "fire",
      eliminated: ["nature"],
      expectedMateIn: 4,
    },
    {
      name: "Mate in 1: Bishop checkmate",
      pieces: [
        {
          id: "fire_king",
          type: "king",
          faction: "fire",
          pos: new Hex(-1, 0),
          symbol: "♚",
          alive: true,
          hasMoved: false,
        },
        {
          id: "fire_bishop",
          type: "bishop",
          faction: "fire",
          pos: new Hex(-2, 1),
          symbol: "♝",
          alive: true,
          hasMoved: false,
        },
        {
          id: "water_king",
          type: "king",
          faction: "water",
          pos: new Hex(0, -3),
          symbol: "♔",
          alive: true,
          hasMoved: false,
        },
      ],
      currentFaction: "fire",
      eliminated: ["nature"],
      expectedMateIn: 1,
    },
    {
      name: "Mate in 2: Knight forces mate",
      pieces: [
        {
          id: "fire_king",
          type: "king",
          faction: "fire",
          pos: new Hex(0, 0),
          symbol: "♚",
          alive: true,
          hasMoved: false,
        },
        {
          id: "fire_knight",
          type: "knight",
          faction: "fire",
          pos: new Hex(1, 1),
          symbol: "♞",
          alive: true,
          hasMoved: false,
        },
        {
          id: "water_king",
          type: "king",
          faction: "water",
          pos: new Hex(-3, 1),
          symbol: "♔",
          alive: true,
          hasMoved: false,
        },
      ],
      currentFaction: "fire",
      eliminated: ["nature"],
      expectedMateIn: 2,
    },
    {
      name: "Mate in 1: Water Queen checkmate",
      pieces: [
        {
          id: "water_king",
          type: "king",
          faction: "water",
          pos: new Hex(0, 0),
          symbol: "♔",
          alive: true,
          hasMoved: false,
        },
        {
          id: "water_queen",
          type: "queen",
          faction: "water",
          pos: new Hex(1, -1),
          symbol: "♕",
          alive: true,
          hasMoved: false,
        },
        {
          id: "fire_king",
          type: "king",
          faction: "fire",
          pos: new Hex(-2, -3),
          symbol: "♚",
          alive: true,
          hasMoved: false,
        },
      ],
      currentFaction: "water",
      eliminated: ["nature"],
      expectedMateIn: 1,
    },
  ];
}

function generateVariations(basePositions) {
  const variations = [...basePositions];
  for (const base of basePositions) {
    variations.push({
      ...base,
      name: base.name + " (mirrored H)",
      pieces: base.pieces.map((p) => ({
        ...p,
        pos: new Hex(-p.pos.q - p.pos.r, p.pos.r),
      })),
    });
    variations.push({
      ...base,
      name: base.name + " (mirrored V)",
      pieces: base.pieces.map((p) => ({
        ...p,
        pos: new Hex(p.pos.q, -p.pos.q - p.pos.r),
      })),
    });
    variations.push({
      ...base,
      name: base.name + " (rotated 120°)",
      pieces: base.pieces.map((p) => ({
        ...p,
        pos: new Hex(-p.pos.r, p.pos.q + p.pos.r),
      })),
    });
    variations.push({
      ...base,
      name: base.name + " (rotated 240°)",
      pieces: base.pieces.map((p) => ({
        ...p,
        pos: new Hex(p.pos.q + p.pos.r, -p.pos.q),
      })),
    });
  }
  return variations;
}

function exportPositionToFEN(posData) {
  const pieces = posData.pieces
    .map((p) => {
      const pieceChar = p.faction[0].toUpperCase() + p.type[0].toUpperCase();
      return `${pieceChar}@${p.pos.q},${p.pos.r}`;
    })
    .join(";");
  return `TSPN:${pieces}#${posData.currentFaction}`;
}

function cloneGame(source) {
  const game = new Game();
  game.init(generateBoard());
  game.rpsEnabled = true;
  game.pieces = source.pieces.map((p) => ({
    ...p,
    pos: new Hex(p.pos.q, p.pos.r),
  }));
  game.currentFaction = source.currentFaction;
  game.currentFactionIdx = source.currentFactionIdx;
  game.eliminatedFactions = new Set(source.eliminatedFactions);
  game.state = source.state;
  game._halfmoveClock = source._halfmoveClock || 0;
  game.capturedPieces = { ...source.capturedPieces };
  game._rebuildOccupiedMap();
  return game;
}

async function validatePuzzle(posData, maxDepth) {
  const game = createGameFromPosition(posData);
  setAIDepth(maxDepth);
  setAIPersonality("tactical");
  const solution = await findForcedMate(game, maxDepth);
  if (!solution || solution.depth !== posData.expectedMateIn)
    return {
      valid: false,
      reason: `Expected mate in ${posData.expectedMateIn}, found ${solution?.depth || "none"}`,
    };
  const game2 = createGameFromPosition(posData);
  setAIDepth(1);
  const actions = getAllActions(game2, game2.currentFaction);
  let winningMoves = 0;
  for (const action of actions) {
    if (action.type !== "attack") continue;
    const testGame = cloneGame(game2);
    testGame.handleCellClick(action.piece.pos);
    const result = testGame.handleCellClick(action.target);
    if (
      result &&
      (result.checkmate ||
        (result.action === "move" &&
          isKingdomCheck(testGame, testGame.currentFaction) &&
          getAllActions(testGame, testGame.currentFaction).length === 0))
    ) {
      winningMoves++;
      if (winningMoves > 1) break;
    }
  }
  if (winningMoves !== 1)
    return {
      valid: false,
      reason: `Not unique solution (${winningMoves} winning moves)`,
    };
  return { valid: true, move: solution.move, mateIn: solution.depth };
}

async function findForcedMate(game, maxDepth) {
  for (let depth = 1; depth <= maxDepth; depth++) {
    setAIDepth(depth);
    const move = iterativeDeepening(game, game.currentFaction);
    if (!move) continue;
    const testGame = cloneGame(game);
    const selectResult = testGame.handleCellClick(move.piece.pos);
    if (!selectResult || selectResult.action !== "select") continue;
    const moveResult = testGame.handleCellClick(move.target);
    if (moveResult && moveResult.checkmate)
      return { depth, move, checkmate: true };
    if (moveResult && moveResult.action === "move") {
      const opponentInCheck = isKingdomCheck(testGame, testGame.currentFaction);
      const oppActions = getAllActions(testGame, testGame.currentFaction);
      if (opponentInCheck && oppActions.length === 0)
        return { depth, move, checkmate: true };
    }
  }
  return null;
}

function createGameFromPosition(posData) {
  const game = new Game();
  game.init(generateBoard());
  game.rpsEnabled = true;
  game.pieces = posData.pieces.map((p) => ({
    ...p,
    pos: p.pos instanceof Hex ? p.pos : new Hex(p.pos.q, p.pos.r),
  }));
  game.currentFaction = posData.currentFaction;
  game.currentFactionIdx = [
    FACTION.FIRE,
    FACTION.WATER,
    FACTION.NATURE,
  ].indexOf(posData.currentFaction);
  game.eliminatedFactions = new Set(posData.eliminated);
  game.state = "select_piece";
  game._rebuildOccupiedMap();
  return game;
}

function exportPositionToFEN(posData) {
  const pieces = posData.pieces
    .map((p) => {
      const pieceChar = p.faction[0].toUpperCase() + p.type[0].toUpperCase();
      return `${pieceChar}@${p.pos.q},${p.pos.r}`;
    })
    .join(";");
  return `TSPN:${pieces}#${posData.currentFaction}`;
}

async function generatePuzzles() {
  console.log("🔍 Generating puzzles...\n");
  const basePositions = getBasePositions();
  const allPositions = generateVariations(basePositions);
  console.log(
    `Generated ${allPositions.length} positions from ${basePositions.length} bases\n`,
  );
  const puzzles = [];
  let processed = 0;
  for (const posData of allPositions) {
    processed++;
    if (processed % 10 === 0)
      console.log(`Progress: ${processed}/${allPositions.length}`);
    try {
      const validation = await validatePuzzle(posData, posData.expectedMateIn);
      if (!validation.valid) continue;
      const puzzle = {
        id: `puzzle_${puzzles.length + 1}`,
        name: posData.name,
        fen: exportPositionToFEN(posData),
        initialPosition: posData,
        solution: [
          {
            pieceId: validation.move.piece.id,
            from: {
              q: validation.move.piece.pos.q,
              r: validation.move.piece.pos.r,
            },
            to: { q: validation.move.target.q, r: validation.move.target.r },
            type: "move",
          },
        ],
        mateIn: validation.mateIn,
        difficulty:
          validation.mateIn <= 2
            ? "easy"
            : validation.mateIn <= 3
              ? "medium"
              : "hard",
        tags: [
          `mate-in-${validation.mateIn}`,
          posData.currentFaction.toLowerCase(),
        ],
      };
      puzzles.push(puzzle);
      console.log(
        `  ✅ ${posData.name}: Mate in ${validation.mateIn} (unique)`,
      );
    } catch (err) {
      console.error(`  ❌ ${posData.name}: ${err.message}`);
    }
  }
  puzzles.sort((a, b) => a.mateIn - b.mateIn);
  const output = {
    version: "1.0",
    generated: new Date().toISOString(),
    totalPuzzles: puzzles.length,
    puzzles: puzzles,
  };
  fs.writeFileSync(PUZZLE_CONFIG.outputFile, JSON.stringify(output, null, 2));
  console.log(
    `\n💾 Saved ${puzzles.length} puzzles to ${PUZZLE_CONFIG.outputFile}`,
  );
  const byDiff = {};
  for (const p of puzzles)
    byDiff[p.difficulty] = (byDiff[p.difficulty] || 0) + 1;
  console.log("By difficulty:", byDiff);
  return puzzles;
}

function getBasePositions() {
  return [
    {
      name: "Mate in 1: Queen checkmate",
      pieces: [
        {
          id: "fire_king",
          type: "king",
          faction: "fire",
          pos: new Hex(0, 0),
          symbol: "♚",
          alive: true,
          hasMoved: false,
        },
        {
          id: "fire_queen",
          type: "queen",
          faction: "fire",
          pos: new Hex(0, -1),
          symbol: "♛",
          alive: true,
          hasMoved: false,
        },
        {
          id: "water_king",
          type: "king",
          faction: "water",
          pos: new Hex(-2, 3),
          symbol: "♔",
          alive: true,
          hasMoved: false,
        },
      ],
      currentFaction: "fire",
      eliminated: ["nature"],
      expectedMateIn: 1,
    },
    {
      name: "Mate in 1: Rook checkmate",
      pieces: [
        {
          id: "fire_king",
          type: "king",
          faction: "fire",
          pos: new Hex(0, 0),
          symbol: "♚",
          alive: true,
          hasMoved: false,
        },
        {
          id: "fire_rook",
          type: "rook",
          faction: "fire",
          pos: new Hex(-3, 0),
          symbol: "♜",
          alive: true,
          hasMoved: false,
        },
        {
          id: "water_king",
          type: "king",
          faction: "water",
          pos: new Hex(-2, 0),
          symbol: "♔",
          alive: true,
          hasMoved: false,
        },
      ],
      currentFaction: "fire",
      eliminated: ["nature"],
      expectedMateIn: 1,
    },
    {
      name: "Mate in 2: Queen forces mate",
      pieces: [
        {
          id: "fire_king",
          type: "king",
          faction: "fire",
          pos: new Hex(0, -1),
          symbol: "♚",
          alive: true,
          hasMoved: false,
        },
        {
          id: "fire_queen",
          type: "queen",
          faction: "fire",
          pos: new Hex(-2, 0),
          symbol: "♛",
          alive: true,
          hasMoved: false,
        },
        {
          id: "water_king",
          type: "king",
          faction: "water",
          pos: new Hex(2, -2),
          symbol: "♔",
          alive: true,
          hasMoved: false,
        },
      ],
      currentFaction: "fire",
      eliminated: ["nature"],
      expectedMateIn: 2,
    },
    {
      name: "Mate in 3: Rook forces mate",
      pieces: [
        {
          id: "fire_king",
          type: "king",
          faction: "fire",
          pos: new Hex(0, 0),
          symbol: "♚",
          alive: true,
          hasMoved: false,
        },
        {
          id: "fire_rook",
          type: "rook",
          faction: "fire",
          pos: new Hex(0, -3),
          symbol: "♜",
          alive: true,
          hasMoved: false,
        },
        {
          id: "water_king",
          type: "king",
          faction: "water",
          pos: new Hex(-5, 5),
          symbol: "♔",
          alive: true,
          hasMoved: false,
        },
      ],
      currentFaction: "fire",
      eliminated: ["nature"],
      expectedMateIn: 3,
    },
    {
      name: "Mate in 4: Two Bishops force mate",
      pieces: [
        {
          id: "fire_king",
          type: "king",
          faction: "fire",
          pos: new Hex(0, -1),
          symbol: "♚",
          alive: true,
          hasMoved: false,
        },
        {
          id: "fire_bishop1",
          type: "bishop",
          faction: "fire",
          pos: new Hex(1, -2),
          symbol: "♝",
          alive: true,
          hasMoved: false,
        },
        {
          id: "fire_bishop2",
          type: "bishop",
          faction: "fire",
          pos: new Hex(-1, -2),
          symbol: "♝",
          alive: true,
          hasMoved: false,
        },
        {
          id: "water_king",
          type: "king",
          faction: "water",
          pos: new Hex(-3, 3),
          symbol: "♔",
          alive: true,
          hasMoved: false,
        },
      ],
      currentFaction: "fire",
      eliminated: ["nature"],
      expectedMateIn: 4,
    },
    {
      name: "Mate in 1: Bishop checkmate",
      pieces: [
        {
          id: "fire_king",
          type: "king",
          faction: "fire",
          pos: new Hex(-1, 0),
          symbol: "♚",
          alive: true,
          hasMoved: false,
        },
        {
          id: "fire_bishop",
          type: "bishop",
          faction: "fire",
          pos: new Hex(-2, 1),
          symbol: "♝",
          alive: true,
          hasMoved: false,
        },
        {
          id: "water_king",
          type: "king",
          faction: "water",
          pos: new Hex(0, -3),
          symbol: "♔",
          alive: true,
          hasMoved: false,
        },
      ],
      currentFaction: "fire",
      eliminated: ["nature"],
      expectedMateIn: 1,
    },
    {
      name: "Mate in 2: Knight forces mate",
      pieces: [
        {
          id: "fire_king",
          type: "king",
          faction: "fire",
          pos: new Hex(0, 0),
          symbol: "♚",
          alive: true,
          hasMoved: false,
        },
        {
          id: "fire_knight",
          type: "knight",
          faction: "fire",
          pos: new Hex(1, 1),
          symbol: "♞",
          alive: true,
          hasMoved: false,
        },
        {
          id: "water_king",
          type: "king",
          faction: "water",
          pos: new Hex(-3, 1),
          symbol: "♔",
          alive: true,
          hasMoved: false,
        },
      ],
      currentFaction: "fire",
      eliminated: ["nature"],
      expectedMateIn: 2,
    },
    {
      name: "Mate in 1: Water Queen checkmate",
      pieces: [
        {
          id: "water_king",
          type: "king",
          faction: "water",
          pos: new Hex(0, 0),
          symbol: "♔",
          alive: true,
          hasMoved: false,
        },
        {
          id: "water_queen",
          type: "queen",
          faction: "water",
          pos: new Hex(1, -1),
          symbol: "♕",
          alive: true,
          hasMoved: false,
        },
        {
          id: "fire_king",
          type: "king",
          faction: "fire",
          pos: new Hex(-2, -3),
          symbol: "♚",
          alive: true,
          hasMoved: false,
        },
      ],
      currentFaction: "water",
      eliminated: ["nature"],
      expectedMateIn: 1,
    },
  ];
}

function generateVariations(basePositions) {
  const variations = [...basePositions];
  for (const base of basePositions) {
    variations.push({
      ...base,
      name: base.name + " (mirrored H)",
      pieces: base.pieces.map((p) => ({
        ...p,
        pos: new Hex(-p.pos.q - p.pos.r, p.pos.r),
      })),
    });
    variations.push({
      ...base,
      name: base.name + " (mirrored V)",
      pieces: base.pieces.map((p) => ({
        ...p,
        pos: new Hex(p.pos.q, -p.pos.q - p.pos.r),
      })),
    });
    variations.push({
      ...base,
      name: base.name + " (rotated 120°)",
      pieces: base.pieces.map((p) => ({
        ...p,
        pos: new Hex(-p.pos.r, p.pos.q + p.pos.r),
      })),
    });
    variations.push({
      ...base,
      name: base.name + " (rotated 240°)",
      pieces: base.pieces.map((p) => ({
        ...p,
        pos: new Hex(p.pos.q + p.pos.r, -p.pos.q),
      })),
    });
  }
  return variations;
}

function exportPositionToFEN(posData) {
  const pieces = posData.pieces
    .map((p) => {
      const pieceChar = p.faction[0].toUpperCase() + p.type[0].toUpperCase();
      return `${pieceChar}@${p.pos.q},${p.pos.r}`;
    })
    .join(";");
  return `TSPN:${pieces}#${posData.currentFaction}`;
}

async function generatePuzzles() {
  console.log("🔍 Generating puzzles...\n");
  const basePositions = getBasePositions();
  const allPositions = generateVariations(basePositions);
  console.log(
    `Generated ${allPositions.length} positions from ${basePositions.length} bases\n`,
  );
  const puzzles = [];
  let processed = 0;
  for (const posData of allPositions) {
    processed++;
    if (processed % 10 === 0)
      console.log(`Progress: ${processed}/${allPositions.length}`);
    try {
      const validation = await validatePuzzle(posData, posData.expectedMateIn);
      if (!validation.valid) continue;
      const puzzle = {
        id: `puzzle_${puzzles.length + 1}`,
        name: posData.name,
        fen: exportPositionToFEN(posData),
        initialPosition: posData,
        solution: [
          {
            pieceId: validation.move.piece.id,
            from: {
              q: validation.move.piece.pos.q,
              r: validation.move.piece.pos.r,
            },
            to: { q: validation.move.target.q, r: validation.move.target.r },
            type: "move",
          },
        ],
        mateIn: validation.mateIn,
        difficulty:
          validation.mateIn <= 2
            ? "easy"
            : validation.mateIn <= 3
              ? "medium"
              : "hard",
        tags: [
          `mate-in-${validation.mateIn}`,
          posData.currentFaction.toLowerCase(),
        ],
      };
      puzzles.push(puzzle);
      console.log(
        `  ✅ ${posData.name}: Mate in ${validation.mateIn} (unique)`,
      );
    } catch (err) {
      console.error(`  ❌ ${posData.name}: ${err.message}`);
    }
  }
  puzzles.sort((a, b) => a.mateIn - b.mateIn);
  const output = {
    version: "1.0",
    generated: new Date().toISOString(),
    totalPuzzles: puzzles.length,
    puzzles: puzzles,
  };
  fs.writeFileSync(PUZZLE_CONFIG.outputFile, JSON.stringify(output, null, 2));
  console.log(
    `\n💾 Saved ${puzzles.length} puzzles to ${PUZZLE_CONFIG.outputFile}`,
  );
  const byDiff = {};
  for (const p of puzzles)
    byDiff[p.difficulty] = (byDiff[p.difficulty] || 0) + 1;
  console.log("By difficulty:", byDiff);
  return puzzles;
}

generatePuzzles().catch(console.error);
export { generatePuzzles, createGameFromPosition, exportPositionToFEN };
