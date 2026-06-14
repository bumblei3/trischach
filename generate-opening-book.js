#!/usr/bin/env node
/**
 * TriSchach Opening Book Generator
 *
 * Generates the compiled opening book from JSON source.
 * Can be run standalone: node generate-opening-book.js
 * Or imported and used programmatically.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import game modules
import { generateBoard } from "./js/board.js";
import { Hex } from "./js/hex.js";
import { Game } from "./js/game.js";

// Opening book storage (local for generation)
const OPENING_BOOK = new Map();

const JSON_FILE = path.join(__dirname, "opening-book.json");
const OUTPUT_FILE = path.join(__dirname, "opening-book.compiled.json");

// Parse move string "pieceId -> q,r"
function parseMoveString(game, moveStr) {
  const [piecePart, targetPart] = moveStr.split("->").map((s) => s.trim());
  const piece = game.pieces.find((p) => p.id === piecePart);
  if (!piece) return null;

  const [q, r] = targetPart.split(",").map(Number);
  if (isNaN(q) || isNaN(r)) return null;

  return { piece, target: new Hex(q, r) };
}

// Board hash matching ai.js exactly
function boardHash(game) {
  const pieces = game
    .getAlivePieces()
    .filter((p) => p.alive)
    .map((p) => `${p.faction[0]}${p.type[0]}${p.pos.q},${p.pos.r}`)
    .sort()
    .join("|");
  return `${pieces}#${game.currentFactionIdx}`;
}

// Load JSON source
function loadSource() {
  const raw = fs.readFileSync(JSON_FILE, "utf-8");
  return JSON.parse(raw);
}

// Build the compiled book using actual Game simulation
function buildCompiledBook(source) {
  const compiledBook = new Map();
  const stats = {
    totalPositions: 0,
    totalVariations: 0,
    maxDepth: 0,
    linesProcessed: 0,
    warnings: [],
  };

  for (const [_factionKey, factionLines] of Object.entries(source.lines)) {
    for (const [, lineData] of Object.entries(factionLines)) {
      const { name, weight: initialWeight, moves } = lineData;

      // Create fresh game for each line
      const game = new Game();
      const cells = generateBoard();
      game.init(cells);

      let currentWeight = initialWeight;

      for (let i = 0; i < moves.length; i++) {
        const hash = boardHash(game);
        const moveStr = moves[i];
        const parsed = parseMoveString(game, moveStr);

        if (!parsed) {
          stats.warnings.push(`${name}: Invalid move ${moveStr} at ply ${i}`);
          break;
        }

        const entry = {
          pieceId: parsed.piece.id,
          targetQ: parsed.target.q,
          targetR: parsed.target.r,
        };

        if (!compiledBook.has(hash)) {
          compiledBook.set(hash, []);
        }
        const variations = compiledBook.get(hash);

        const exists = variations.some(
          (v) =>
            v.move.pieceId === entry.pieceId &&
            v.move.targetQ === entry.targetQ &&
            v.move.targetR === entry.targetR,
        );

        if (!exists) {
          variations.push({ move: entry, weight: currentWeight });
        }

        // Actually make the move on the game
        const selectResult = game.handleCellClick(parsed.piece.pos);
        if (!selectResult || selectResult.action !== "select") {
          stats.warnings.push(
            `${name}: Failed to select piece ${parsed.piece.id} at ply ${i}`,
          );
          break;
        }
        const result = game.handleCellClick(parsed.target);
        // Handle promotion FIRST (can be move or combat with promotion)
        if (result && result.promotion) {
          game.completePromotion("queen");
        } else if (
          result &&
          (result.action === "move" || result.action === "combat")
        ) {
          // Move successful
        } else {
          stats.warnings.push(`${name}: Move ${moveStr} failed at ply ${i}`);
          break;
        }

        currentWeight = Math.max(currentWeight * 0.85, 10);
        stats.maxDepth = Math.max(stats.maxDepth, i + 1);
      }

      stats.linesProcessed++;
    }
  }

  stats.totalPositions = compiledBook.size;
  stats.totalVariations = Array.from(compiledBook.values()).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );

  return { compiledBook, stats };
}

// Save compiled book
function saveCompiledBook(compiledBook, source, stats) {
  // Convert Map to object for JSON serialization
  const bookObj = {};
  for (const [hash, variations] of compiledBook.entries()) {
    bookObj[hash] = variations;
  }

  const output = {
    version: source.version,
    metadata: {
      ...source.metadata,
      compiled: new Date().toISOString(),
      stats,
    },
    book: bookObj,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Saved compiled book to ${OUTPUT_FILE}`);

  return output;
}

// Load compiled book (for use in production)
async function loadCompiledBook() {
  try {
    // Use dynamic import for ES modules
    const module = await import("../opening-book.compiled.json");
    const data = module.default;

    if (!data || !data.book) {
      console.warn("Compiled book not found, run generator first");
      return null;
    }

    // Load book into Map
    for (const [hash, variations] of Object.entries(data.book)) {
      OPENING_BOOK.set(hash, variations);
    }

    console.log(
      `Loaded compiled book: ${data.metadata.stats.totalPositions} positions`,
    );
    return data;
  } catch {
    console.warn("Compiled book load failed");
    return null;
  }
}

// Main generation
async function main() {
  console.log("=== TriSchach Opening Book Generator ===");
  console.log(`Loading source from ${JSON_FILE}...`);

  const source = loadSource();
  console.log(`Source version: ${source.version}`);
  console.log(`Factions: ${Object.keys(source.lines).join(", ")}`);

  console.log("\nBuilding compiled book...");
  const { compiledBook, stats } = buildCompiledBook(source);

  console.log("\n--- Statistics ---");
  console.log(`Lines processed: ${stats.linesProcessed}`);
  console.log(`Total positions: ${stats.totalPositions}`);
  console.log(`Total variations: ${stats.totalVariations}`);
  console.log(`Max depth: ${stats.maxDepth}`);

  if (stats.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const w of stats.warnings) {
      console.log(`  - ${w}`);
    }
  }

  saveCompiledBook(compiledBook, source, stats);

  console.log("\n✅ Generation complete!");
}

if (import.meta.url.includes("generate-opening-book")) {
  main().catch(console.error);
}

export { buildCompiledBook, parseMoveString, boardHash, loadCompiledBook };
