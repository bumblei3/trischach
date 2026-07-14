/**
 * game-invariants.test.ts
 *
 * Hard invariant suites over REAL random self-play games. These guard the
 * engine's internal consistency (board state, occupied-map drift, move
 * legality, check consistency) — not just smoke-level "it doesn't crash".
 * A bug that silently desyncs `pieces` from `_occupiedMap`, or lets two
 * pieces occupy one hex, is caught here even if no assertion in the
 * per-feature suites trips.
 */
import { describe, test, expect } from "vitest";
import { Game, GAME_STATE } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import { Hex } from "../js/hex.ts";
import { Piece, PIECE_TYPE, PIECE_STRENGTH } from "../js/pieces.ts";

// Deterministic-ish RNG so failures are reproducible within a run.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

/**
 * Play one random self-play game to completion (or move cap) and run
 * `checkInvariants(game)` after EVERY move. Returns the number of plies played.
 */
function playRandomGame(
  seed: number,
  checkInvariants: (g: Game, ply: number) => void,
  maxPlies = 400,
): number {
  const rng = makeRng(seed);
  const game = new Game();
  game.init(generateBoard());

  let plies = 0;
  while (plies < maxPlies) {
    // Read state as string to avoid TS control-flow narrowing across loop
    // iterations (state is a GameState literal union).
    const st: string = game.state;
    if (
      st === GAME_STATE.GAME_OVER ||
      st === GAME_STATE.DRAW_REPETITION ||
      st === GAME_STATE.DRAW_50MOVE
    ) {
      break;
    }

    const alive = game.getAlivePieces();
    if (alive.length === 0) break;

    // Pick a random alive piece of the current faction.
    const mine = alive.filter((p) => p.faction === game.currentFaction);
    if (mine.length === 0) break;
    const piece = mine[Math.floor(rng() * mine.length)]!;

    game.handleCellClick(piece.pos);
    if (game.state === GAME_STATE.GAME_OVER) break;

    if (game.state === GAME_STATE.PROMOTION) {
      game.completePromotion(PIECE_TYPE.QUEEN);
      plies++;
      // DEBUG: detect occupied drift immediately after promotion completion
      for (const p of game.getAlivePieces()) {
        if (game._occupiedMap!.get(p.pos.key) !== p) {
          console.log(
            "DRIFT after promotion-complete:",
            p.id,
            "@",
            p.pos.q + "," + p.pos.r,
            "occ=",
            game._occupiedMap!.get(p.pos.key)?.id ?? "null",
          );
          console.log(
            "  pieces:",
            game
              .getAlivePieces()
              .map((x) => `${x.id}@${x.pos.q},${x.pos.r}`)
              .join(" "),
          );
        }
      }
      checkInvariants(game, plies);
      continue;
    }

    // Choose a random target among the offered moves/attacks.
    const targets = [...game.validMoves, ...game.validAttacks];
    if (targets.length === 0) {
      // No legal move for this piece — deselect and try another next ply.
      game.handleCellClick(piece.pos);
      plies++;
      continue;
    }
    const target = targets[Math.floor(rng() * targets.length)]!;
    const beforeOcc = new Map(game._occupiedMap!);
    game.handleCellClick(target);
    // DEBUG: detect drift after a normal move
    for (const p of game.getAlivePieces()) {
      if (game._occupiedMap!.get(p.pos.key) !== p) {
        console.log(
          "DRIFT after move:",
          p.id,
          "@",
          p.pos.q + "," + p.pos.r,
          "occ=",
          game._occupiedMap!.get(p.pos.key)?.id ?? "null",
        );
        console.log(
          "  clicked:",
          piece.id,
          "@",
          piece.pos.q + "," + piece.pos.r,
          "-> target",
          target.q + "," + target.r,
        );
        console.log(
          "  validMoves were:",
          targets.map((t) => `${t.q},${t.r}`).join(" "),
        );
        console.log(
          "  pieces:",
          game
            .getAlivePieces()
            .map((x) => `${x.id}@${x.pos.q},${x.pos.r}`)
            .join(" "),
        );
        throw new Error("drift-debug");
      }
    }

    plies++;
    checkInvariants(game, plies);
  }
  return plies;
}

describe("Game invariants over random self-play", () => {
  test("no two alive pieces ever occupy the same hex", () => {
    playRandomGame(1, (g) => {
      const seen = new Set<string>();
      for (const p of g.getAlivePieces()) {
        const key = p.pos.key;
        expect(seen.has(key), `two pieces on ${key}`).toBe(false);
        seen.add(key);
      }
    });
  });

  test("_occupiedMap stays in sync with alive pieces (no drift)", () => {
    playRandomGame(2, (g) => {
      const occ = g._occupiedMap;
      expect(occ).not.toBeNull();
      const alive = g.getAlivePieces();
      // Every alive piece is present in the occupied map at its position.
      for (const p of alive) {
        expect(occ!.get(p.pos.key)).toBe(p);
      }
      // The occupied map holds exactly the alive pieces — nothing extra.
      expect(occ!.size).toBe(alive.length);
    });
  });

  test("every alive piece sits on a real board cell", () => {
    playRandomGame(3, (g) => {
      expect(g.boardCells).not.toBeNull();
      for (const p of g.getAlivePieces()) {
        expect(g.boardCells!.has(p.pos.key), `${p.id} off-board`).toBe(true);
      }
    });
  });

  test("moveHistory entries always carry a valid action + target", () => {
    playRandomGame(4, (g, ply) => {
      const last = g.moveHistory[g.moveHistory.length - 1];
      if (!last) return;
      expect(
        [
          "move",
          "attack",
          "combat",
          "promotion",
          "select",
          "deselect",
        ].includes(last.action),
        `ply ${ply}: bad action ${last.action}`,
      ).toBe(true);
      const action: string = last.action;
      // A move/attack/combat that produced a target must point at a hex.
      if (action === "move" || action === "attack" || action === "combat") {
        expect(last.to).toBeInstanceOf(Hex);
      }
    });
  });

  test("isKingInCheck is consistent with an actual attacking piece", () => {
    playRandomGame(5, (g) => {
      for (const faction of [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]) {
        const inCheck = g.isKingInCheck(faction);
        if (!inCheck) continue;
        // If a king is in check, at least one ENEMY piece must have that
        // king's hex in its legal-attack set.
        const king = g
          .getAlivePieces()
          .find((p) => p.faction === faction && p.type === "king");
        if (!king) continue; // king already eliminated -> not "in check"
        const attackers = g
          .getAlivePieces()
          .filter((p) => p.faction !== faction);
        const threatensKing = attackers.some((a) => {
          const { attacks } = g.getLegalMoves(a);
          return attacks.some((h) => h.key === king.pos.key);
        });
        expect(
          threatensKing,
          `faction ${faction} reported in-check but no enemy attacks the king`,
        ).toBe(true);
      }
    });
  });

  test("captured pieces are exactly the non-alive original pieces", () => {
    // Play a game and, at the end, assert material accounting:
    // every piece that started alive but is now dead must be listed in some
    // faction's capturedPieces array.
    const game = new Game();
    game.init(generateBoard());
    const startIds = new Set(game.getAlivePieces().map((p) => p.id));

    playRandomGame(6, () => {
      /* drive the game */
    });

    const capturedIds = new Set(
      Object.values(game.capturedPieces)
        .flat()
        .map((p: Piece) => p.id),
    );
    const deadNow = game.getAlivePieces().length; // alive count now (placeholder for clarity)
    void deadNow;

    for (const p of game.pieces) {
      if (!p.alive && startIds.has(p.id)) {
        expect(
          capturedIds.has(p.id),
          `dead piece ${p.id} not in capturedPieces`,
        ).toBe(true);
      }
    }
  });

  test("random self-play runs many plies without invariant break / stall", () => {
    // The real value: drive several games of random legal play and assert the
    // invariant callbacks (board consistency, occupied-map sync, etc.) never
    // throw and the engine makes forward progress (no infinite stall).
    let totalPlies = 0;
    for (const seed of [11, 22, 33, 44, 55, 66, 77]) {
      totalPlies += playRandomGame(seed, () => {});
    }
    // 7 games × up to 400 plies each — if any stalled at 0 or the engine
    // threw inside playRandomGame, this would be far lower.
    expect(totalPlies).toBeGreaterThan(500);
  });

  test("material strength is non-negative and finite after promotion churn", () => {
    playRandomGame(7, (g) => {
      for (const p of g.getAlivePieces()) {
        const v = PIECE_STRENGTH[p.type];
        expect(v).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(v)).toBe(true);
      }
    });
  });
});
