/**
 * RPS-Tactic Puzzles — trains picking the correct RPS counter-strike.
 *
 * Unlike the Mate-in-N puzzles (js/puzzle.ts), these test RPS reading: given a
 * position, the player must choose the move that wins the RPS exchange (an
 * advantage attack) and avoid disadvantage (suicide) strikes.
 *
 * This module is intentionally isolated from puzzle.ts (the Mate system) and
 * from analysis.ts (to avoid a circular import). It reuses the SAME `fen`
 * serialization format as puzzle.ts (`Fp0,0|Wk1,1#0`) and the SAME real
 * `getRPSResult` RPS core from board.ts — so a future RPS-cycle regression in
 * board.ts would break these puzzles too (good: they act as a guard).
 */
import { Game } from "./game.ts";
import { generateBoard, FACTION, getRPSResult } from "./board.ts";
import { getLegalMoves } from "./ai-core.ts";
import { Piece } from "./pieces.ts";
import { Hex } from "./hex.ts";
import type { Faction, PieceType } from "./types.ts";

export type RPSOutcome = "advantage" | "neutral" | "disadvantage";

/** Thin, named wrapper over the real RPS core (board.ts:52). */
export function getRPSOutcome(
  attacker: Faction,
  defender: Faction,
): RPSOutcome {
  return getRPSResult(attacker, defender);
}

export interface RpsPuzzle {
  id: string;
  /** Serialized position, same format as puzzle.ts fen (`Fp0,0|Wk1,1#0`). */
  fen: string;
  sideToMove: Faction;
  /** Hex key of the piece that must move. */
  correctPieceKey: string;
  /** Hex key of the correct target (the RPS-advantage strike / safe move). */
  correctTargetKey: string;
  /** Why this is correct, in human wording. */
  rationale: string;
  difficulty: "easy" | "medium" | "hard";
  createdAt: number;
}

const FACTION_CHARS: Record<Faction, string> = {
  fire: "F",
  water: "W",
  nature: "N",
};
const TYPE_CHARS: Record<PieceType, string> = {
  king: "k",
  queen: "q",
  rook: "r",
  bishop: "b",
  knight: "n",
  pawn: "p",
};
const FACTIONS: Faction[] = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

/** Build a Hex from a "q,r" key string. */
function hexFromKey(key: string): Hex {
  const parts = key.split(",").map(Number) as number[];
  return new Hex(parts[0]!, parts[1]!);
}

/** Serialize a Game to the puzzle.ts fen string. */
function serializePosition(game: Game): string {
  const pieces = game
    .getAlivePieces()
    .filter((p) => p.alive)
    .map(
      (p) =>
        `${FACTION_CHARS[p.faction]}${TYPE_CHARS[p.type]}${p.pos.q},${p.pos.r}`,
    )
    .join("|");
  return `${pieces}#${game.currentFactionIdx}`;
}

/** Rebuild a Game from a fen string (mirrors puzzle.ts reconstructGameFromHash). */
export function deserializeRpsPosition(fen: string): Game | null {
  try {
    const [piecesStr, factionIdxStr] = fen.split("#");
    const factionIdx = parseInt(factionIdxStr ?? "0", 10);
    const game = new Game();
    const cells = generateBoard();
    game.init(cells as never);
    // Place fresh pieces at the serialized coordinates (don't rely on the
    // default starting layout matching them).
    game.pieces = [];
    game.eliminatedFactions = new Set<Faction>();
    const typeMap: Record<string, PieceType> = {
      k: "king",
      q: "queen",
      r: "rook",
      b: "bishop",
      n: "knight",
      p: "pawn",
    };
    if (piecesStr) {
      for (const entry of piecesStr.split("|")) {
        if (!entry) continue;
        const faction =
          entry[0] === "F" ? "fire" : entry[0] === "W" ? "water" : "nature";
        const typeChar = entry[1]!;
        const [q, r] = entry.slice(2).split(",").map(Number) as [
          number,
          number,
        ];
        const type = typeMap[typeChar] ?? "pawn";
        const cell = cells.get(`${q},${r}`);
        if (!cell) continue;
        game.pieces.push(new Piece(type, faction, cell.hex));
      }
    }
    game.currentFactionIdx = factionIdx % 3;
    game.currentFaction = FACTIONS[game.currentFactionIdx] ?? "fire";
    game._rebuildOccupiedMap();
    return game;
  } catch {
    return null;
  }
}

/** All legal (piece, target) attack moves for the side to move, with RPS outcome. */
function attacksWithOutcome(game: Game, faction: Faction) {
  const out: { pieceKey: string; targetKey: string; outcome: RPSOutcome }[] =
    [];
  const pieces = game
    .getAlivePieces()
    .filter((p) => p.alive && p.faction === faction);
  for (const piece of pieces) {
    const { attacks } = getLegalMoves(game as never, piece as never);
    for (const target of attacks) {
      const defender = game.getPieceAt(target);
      if (!defender) continue;
      out.push({
        pieceKey: piece.pos.key,
        targetKey: target.key,
        outcome: getRPSOutcome(faction, defender.faction),
      });
    }
  }
  return out;
}

/**
 * Build one RPS puzzle from a crafted skirmish where the side-to-move has
 * exactly ONE advantage attack (the unique correct answer) and at least one
 * disadvantage attack (the trap). Uses a side (pawn + king) vs TWO enemy pieces
 * of different factions — so one enemy is an advantage target, the other a
 * disadvantage target. (A single enemy pawn would give the side's pawn+king
 * the same RPS outcome, never a mixed advantage/disadvantage pair.)
 */
function deriveRpsPuzzle(spec: {
  side: Faction;
  pieces: { type: PieceType; faction: Faction; key: string }[];
}): RpsPuzzle | null {
  const cells = generateBoard();
  const game = new Game();
  game.init(cells as never);
  game.pieces = [];
  // All three factions stay alive (no elimination needed for an RPS puzzle).
  game.eliminatedFactions = new Set<Faction>();
  for (const s of spec.pieces) {
    game.pieces.push(new Piece(s.type, s.faction, cells.get(s.key)!.hex));
  }
  game.currentFactionIdx = FACTIONS.indexOf(spec.side);
  game.currentFaction = spec.side;
  game._rebuildOccupiedMap();

  const attacks = attacksWithOutcome(game, spec.side);
  const advantages = attacks.filter((a) => a.outcome === "advantage");
  const disadvantages = attacks.filter((a) => a.outcome === "disadvantage");
  if (advantages.length !== 1 || disadvantages.length === 0) return null;

  const best = advantages[0]!;
  const targetFaction = game.getPieceAt(hexFromKey(best.targetKey))?.faction;
  return {
    id: `rps-${spec.side}-${best.pieceKey}-${best.targetKey}`,
    fen: serializePosition(game),
    sideToMove: spec.side,
    correctPieceKey: best.pieceKey,
    correctTargetKey: best.targetKey,
    rationale: `Schlägt eine ${labelFaction(targetFaction)} Figur, die du im Stein-Schere-Papier-Zyklus schlägst (Vorteil).`,
    difficulty: "easy",
    createdAt: Date.now(),
  };
}

function labelFaction(f: Faction | undefined): string {
  if (f === FACTION.FIRE) return "Feuer";
  if (f === FACTION.WATER) return "Wasser";
  if (f === FACTION.NATURE) return "Natur";
  return "?";
}

/**
 * Generate RPS puzzles by enumerating small 2-faction placements on the real
 * board and keeping those with a unique advantage answer + a disadvantage trap.
 */
export function generateRpsPuzzles(count = 10): RpsPuzzle[] {
  const cells = Array.from(generateBoard().keys());
  const out: RpsPuzzle[] = [];
  // Enumerate 2-piece setups (one attacker + one target per side) over a
  // bounded cell set so generation is fast and deterministic enough.
  const sample = cells.slice(0, 12);
  for (const side of FACTIONS) {
    const advTarget = FACTIONS.find(
      (f) => getRPSOutcome(side, f) === "advantage",
    )!;
    const disTarget = FACTIONS.find(
      (f) => getRPSOutcome(side, f) === "disadvantage",
    )!;
    for (let i = 0; i < sample.length && out.length < count; i++) {
      // side pawn (attacker)
      for (let j = 0; j < sample.length && out.length < count; j++) {
        if (j === i) continue;
        // advantage target piece
        for (let m = 0; m < sample.length && out.length < count; m++) {
          if (m === i || m === j) continue;
          // disadvantage target piece
          for (let k = 0; k < sample.length && out.length < count; k++) {
            if (k === i || k === j || k === m) continue;
            // side king (so the side has 2 pieces, not just the pawn)
            const spec = {
              side,
              pieces: [
                { type: "pawn" as PieceType, faction: side, key: sample[i]! },
                {
                  type: "pawn" as PieceType,
                  faction: advTarget,
                  key: sample[j]!,
                },
                {
                  type: "pawn" as PieceType,
                  faction: disTarget,
                  key: sample[m]!,
                },
                { type: "king" as PieceType, faction: side, key: sample[k]! },
              ],
            };
            const p = deriveRpsPuzzle(spec);
            if (p) out.push(p);
          }
        }
      }
    }
  }
  return out;
}

/**
 * Decide whether a player's chosen move is correct, using real RPS logic —
 * not a fixed solution line.
 */
export function evaluateRpsMove(
  puzzle: RpsPuzzle,
  pieceKey: string,
  targetKey: string,
): { correct: boolean; outcome: RPSOutcome; rationale: string } {
  const game = deserializeRpsPosition(puzzle.fen);
  if (!game)
    return {
      correct: false,
      outcome: "neutral",
      rationale: "Ungültige Position.",
    };
  const piece = game.getPieceAt(hexFromKey(pieceKey));
  const target = game.getPieceAt(hexFromKey(targetKey));
  if (!piece || !target)
    return { correct: false, outcome: "neutral", rationale: "Ungültiger Zug." };
  const outcome = getRPSOutcome(piece.faction, target.faction);
  const correct =
    pieceKey === puzzle.correctPieceKey &&
    targetKey === puzzle.correctTargetKey;
  const rationale =
    outcome === "advantage"
      ? "RPS-Vorteil: du schlägst die gegnerische Figur im Zyklus."
      : outcome === "disadvantage"
        ? "RPS-Nachteil: du verlierst diesen Tausch — beiß nicht in die Falle."
        : "Neutraler Schlag — nicht der taktische Schlüsselzug.";
  return { correct, outcome, rationale };
}
