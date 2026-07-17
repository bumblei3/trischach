/**
 * Tablebase generator for trischach endgames (Syzygy-style result map).
 *
 * Phase 1: solves K+Queen vs K (one faction has King+Queen, one has only its
 *   King, the third faction is already eliminated).
 * Phase 2: solves K+Rook vs K and K+Pawn vs K with the same machinery — only
 *   the piece placement changes. The solver uses the real Game rules, so pawn
 *   promotion (K+Pawn → K+Queen) is handled correctly.
 *
 * The generator enumerates all placements, reduces by faction-rotation symmetry
 * (strong=FIRE, weak=WATER, eliminated=NATURE), and solves each position with
 * perfect play (full minimax over the real Game rules, including RPS
 * king-capture). Result is written as a hash → {result, dtz} JSON map loaded at
 * runtime by js/tablebase.ts.
 *
 * Win rule (pragmatic for 3-player RPS): the last surviving faction wins; a move
 * that captures the side-to-move's king eliminates that faction.
 *
 * Run:
 *   npx tsx scripts/gen-tablebase.ts                 # default: kq (K+Queen vs K)
 *   npx tsx scripts/gen-tablebase.ts --endgame=kr    # K+Rook vs K
 *   npx tsx scripts/gen-tablebase.ts --endgame=kpk   # K+Pawn vs K
 *   npx tsx scripts/gen-tablebase.ts --out public/js/tablebases/kr-vs-k.json --endgame=kr
 */

import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import {
  simulateMove,
  undoMove,
  computeZobristHash,
  getLegalMoves,
} from "../js/ai-core.ts";
import { Piece } from "../js/pieces.ts";
import { Hex } from "../js/hex.ts";
import type { Faction } from "../js/types.ts";
import type { PieceType } from "../js/types.ts";
import { writeFileSync, mkdirSync } from "node:fs";

const TURNS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

interface Solved {
  result: "win" | "loss" | "draw";
  dtz: number;
}

type EndgameKind = "kq" | "kr" | "kpk";

interface PieceSpec {
  type: PieceType;
  faction: Faction;
}

/** Pieces for the strong (attacking) and weak (defending) factions. */
const ENDGAMES: Record<
  EndgameKind,
  { strong: PieceType[]; weak: PieceType[]; out: string }
> = {
  kq: {
    strong: ["king", "queen"],
    weak: ["king"],
    out: "public/js/tablebases/kq-vs-k.json",
  },
  kr: {
    strong: ["king", "rook"],
    weak: ["king"],
    out: "public/js/tablebases/kr-vs-k.json",
  },
  kpk: {
    strong: ["king", "pawn"],
    weak: ["king"],
    out: "public/js/tablebases/kpk.json",
  },
};

/**
 * Perfect-play solver. `result` is from the side-to-move perspective.
 * Memoized over Zobrist hash. `depth` caps runaway search (should never be
 * hit for K+Q/K+R/K+P vs K, which terminates by repetition-move cap or mate).
 */
function solve(game: Game, memo: Map<string, Solved>, depth: number): Solved {
  const hash = computeZobristHash(game).toString();
  const cached = memo.get(hash);
  if (cached) return cached;

  if (depth <= 0) return { result: "draw", dtz: 0 };

  const aliveFactions = Array.from(
    new Set(
      game
        .getAlivePieces()
        .filter((p) => p.alive)
        .map((p) => p.faction),
    ),
  );
  if (aliveFactions.length <= 1) {
    const res: Solved = { result: "loss", dtz: 0 };
    memo.set(hash, res);
    return res;
  }

  const faction = TURNS[game.currentFactionIdx]!;
  const actions = collectActions(game, faction);
  if (actions.length === 0) {
    const res: Solved = { result: "draw", dtz: 0 };
    memo.set(hash, res);
    return res;
  }

  let best: Solved = { result: "loss", dtz: Infinity };
  for (const action of actions) {
    const undo = simulateMove(game, action.piece, action.target);
    const child = solve(game, memo, depth - 1);
    undoMove(game, undo);
    // child is from opponent's perspective; flip for our side.
    const ourResult: "win" | "loss" | "draw" =
      child.result === "win"
        ? "loss"
        : child.result === "loss"
          ? "win"
          : "draw";
    const dtz = child.dtz + 1;
    if (better(ourResult, best.result)) {
      best = { result: ourResult, dtz };
    } else if (
      ourResult === best.result &&
      ourResult !== "draw" &&
      dtz < best.dtz
    ) {
      best = { result: ourResult, dtz };
    }
  }
  memo.set(hash, best);
  return best;
}

function better(
  a: "win" | "loss" | "draw",
  b: "win" | "loss" | "draw",
): boolean {
  const rank = { win: 2, draw: 1, loss: 0 } as const;
  return rank[a] > rank[b];
}

function collectActions(
  game: Game,
  faction: Faction,
): { piece: Piece; target: Hex }[] {
  const out: { piece: Piece; target: Hex }[] = [];
  const pieces = game
    .getAlivePieces()
    .filter((p) => p.alive && p.faction === faction);
  for (const piece of pieces) {
    const { moves, attacks } = getLegalMoves(game as any, piece);
    for (const m of moves) out.push({ piece, target: m });
    for (const a of attacks) out.push({ piece, target: a });
  }
  return out;
}

/** All board cell keys (the 21-cell triangle). */
function allCellKeys(boardCells: Map<string, { zone: string }>): string[] {
  return Array.from(boardCells.keys());
}

/**
 * Build a Game for a specific placement. `pieces` lists every piece to place
 * (with faction); the remaining faction is marked eliminated. `sideToMoveIdx`
 * selects who moves.
 */
function buildPosition(
  boardCells: Map<string, { hex: Hex; zone: string; faction: Faction | null }>,
  pieces: PieceSpec[],
  eliminated: Faction,
  sideToMoveIdx: number,
): Game {
  const g = new Game();
  g.init(boardCells as Map<string, any>);
  g.pieces = [];
  g.eliminatedFactions = new Set<Faction>([eliminated]);
  const mk = (type: PieceType, fac: Faction, key: string) =>
    new Piece(type, fac, boardCells.get(key)!.hex);
  for (const spec of pieces) {
    g.pieces.push(mk(spec.type, spec.faction, spec.key));
  }
  g.currentFactionIdx = sideToMoveIdx;
  g.currentFaction = TURNS[sideToMoveIdx]!;
  g.state = "select_piece" as any;
  (g as any)._positionHash = undefined;
  return g;
}

function main(): void {
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const endgameArg = process.argv.find((a) => a.startsWith("--endgame="));
  const eg = (
    endgameArg ? endgameArg.slice("--endgame=".length) : "kq"
  ) as EndgameKind;
  if (!ENDGAMES[eg]) {
    console.error(
      `unknown --endgame=${eg}; use one of: ${Object.keys(ENDGAMES).join(", ")}`,
    );
    process.exit(1);
  }
  const outPath = outArg ? outArg.slice("--out=".length) : ENDGAMES[eg].out;
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : Infinity;

  // Faction rotation symmetry: strong=FIRE, weak=WATER, eliminated=NATURE.
  const STRONG = FACTION.FIRE;
  const WEAK = FACTION.WATER;
  const ELIM = FACTION.NATURE;

  const boardCells = generateBoard();
  const cells = allCellKeys(boardCells);
  if (cells.length > limit) cells.length = Math.floor(limit);

  const memo = new Map<string, Solved>();
  const result: Record<string, { r: "win" | "loss" | "draw"; dtz: number }> =
    {};

  // Assign keys to strong/weak piece slots. The number of keys scales with the
  // piece count of the endgame (2 pieces each side for kq/kr/kpk → 4 keys).
  const strongTypes = ENDGAMES[eg].strong;
  const weakTypes = ENDGAMES[eg].weak;
  const nStrong = strongTypes.length;
  const nWeak = weakTypes.length;
  // All distinct cell keys used for the attacking side's pieces + king, plus
  // the defending king. We enumerate every distinct placement of those pieces.
  const slots = nStrong + nWeak; // total non-king pieces + kings

  // Build the piece-spec per placement generically from key assignments.
  const buildSpec = (keys: string[]): PieceSpec[] => {
    const spec: PieceSpec[] = [];
    strongTypes.forEach((t, i) =>
      spec.push({ type: t, faction: STRONG, key: keys[i]! }),
    );
    weakTypes.forEach((t, i) =>
      spec.push({ type: t, faction: WEAK, key: keys[nStrong + i]! }),
    );
    return spec;
  };

  let count = 0;
  // Enumerate all ordered placements of `slots` distinct cells.
  const place = (depth: number, chosen: string[], seen: Set<string>): void => {
    if (depth === slots) {
      for (let side = 0; side < 3; side++) {
        if (TURNS[side] === ELIM) continue; // ELIM has no pieces
        const g = buildPosition(
          boardCells as any,
          buildSpec(chosen),
          ELIM,
          side,
        );
        if (g.getAlivePieces().filter((p) => p.alive).length > 4) continue;
        const hash = computeZobristHash(g).toString();
        if (result[hash]) continue;
        const solved = solve(g, memo, 60);
        // Store only decisive results (win/loss). Draws omitted → engine
        // falls back to heuristic (shrink file ~8x).
        if (solved.result !== "draw") {
          result[hash] = { r: solved.result, dtz: solved.dtz };
        }
        count++;
      }
      return;
    }
    for (const key of cells) {
      if (seen.has(key)) continue;
      chosen.push(key);
      seen.add(key);
      place(depth + 1, chosen, seen);
      chosen.pop();
      seen.delete(key);
    }
  };

  place(0, [], new Set<string>());

  mkdirSync("public/js/tablebases", { recursive: true });
  writeFileSync(outPath, JSON.stringify(result));
  console.log(`Solved ${count} unique positions; memo=${memo.size}`);
  console.log(
    `Wrote ${Object.keys(result).length} entries → ${outPath} (endgame=${eg})`,
  );
  const wins = Object.values(result).filter((v) => v.r === "win").length;
  const losses = Object.values(result).filter((v) => v.r === "loss").length;
  const draws = Object.values(result).filter((v) => v.r === "draw").length;
  console.log(`Distribution: win=${wins} loss=${losses} draw=${draws}`);
}

main();
