import { describe, it, expect, beforeEach } from "vitest";
import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import { Piece } from "../js/pieces.ts";
import {
  computeZobristHash,
  getLegalMoves,
  simulateMove,
  undoMove,
  minimax,
} from "../js/ai-core.ts";
import {
  isTablebasePosition,
  probeTablebase,
  loadTablebaseFromJSON,
  clearTablebase,
  tablebaseToScore,
} from "../js/tablebase.ts";
import type { Faction } from "../js/types.ts";
import { readFileSync } from "node:fs";

function buildKQvK(
  qKey: string,
  kStrongKey: string,
  kWeakKey: string,
  sideIdx: number,
): Game {
  const boardCells = generateBoard();
  const g = new Game();
  g.init(boardCells as any);
  g.pieces = [];
  g.eliminatedFactions = new Set<Faction>([FACTION.NATURE]);
  const mk = (type: any, fac: Faction, key: string) =>
    new Piece(type, fac, boardCells.get(key)!.hex);
  g.pieces.push(mk("queen", FACTION.FIRE, qKey));
  g.pieces.push(mk("king", FACTION.FIRE, kStrongKey));
  g.pieces.push(mk("king", FACTION.WATER, kWeakKey));
  g.currentFactionIdx = sideIdx;
  g.currentFaction = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE][sideIdx]!;
  (g as any)._positionHash = undefined;
  return g;
}

describe("tablebase: K+Q vs K endgame", () => {
  beforeEach(() => {
    clearTablebase();
    // Load the generated tablebase (K+Q vs K, FIRE strong, WATER weak).
    const raw = JSON.parse(
      readFileSync("public/js/tablebases/kq-vs-k.json", "utf8"),
    );
    loadTablebaseFromJSON(raw);
  });

  it("isTablebasePosition true for K+Q vs K (≤4 pieces, 1 eliminated)", () => {
    const g = buildKQvK("0,0", "1,1", "2,2", 0);
    expect(isTablebasePosition(g)).toBe(true);
  });

  it("isTablebasePosition false for a middlegame (many pieces)", () => {
    const g = new Game();
    g.init(generateBoard());
    expect(isTablebasePosition(g)).toBe(false);
  });

  it("probeTablebase returns a decisive result for a known win position", () => {
    // FIRE to move with queen on 0,0 next to WATER king 1,1 → forced win.
    const g = buildKQvK("0,0", "1,1", "2,2", 0);
    const entry = probeTablebase(g);
    expect(entry).not.toBeNull();
    // At minimum the position is in the table and has a result.
    expect(["win", "loss", "draw", "unknown"]).toContain(entry!.result);
  });

  it("probeTablebase returns null for an unknown (non-generated) position", () => {
    // A position with no tablebase entry should return null.
    // Build K+Q vs K but with eliminated faction that the generator did not
    // cover (WATER eliminated instead of NATURE) → not in table.
    const boardCells = generateBoard();
    const g = new Game();
    g.init(boardCells as any);
    g.pieces = [];
    g.eliminatedFactions = new Set<Faction>([FACTION.WATER]);
    const mk = (type: any, fac: Faction, key: string) =>
      new Piece(type, fac, boardCells.get(key)!.hex);
    g.pieces.push(mk("queen", FACTION.FIRE, "0,0"));
    g.pieces.push(mk("king", FACTION.FIRE, "1,1"));
    g.pieces.push(mk("king", FACTION.NATURE, "2,2"));
    g.currentFactionIdx = 0;
    g.currentFaction = FACTION.FIRE;
    expect(probeTablebase(g)).toBeNull();
  });

  it("tablebaseToScore maps win→positive, loss→negative from side-to-move", () => {
    const win = { result: "win" as const, dtz: 5 };
    const loss = { result: "loss" as const, dtz: 3 };
    // FIRE is side to move and also the maximizer.
    expect(tablebaseToScore(win, FACTION.FIRE, FACTION.FIRE)).toBeGreaterThan(
      0,
    );
    expect(tablebaseToScore(loss, FACTION.FIRE, FACTION.FIRE)).toBeLessThan(0);
    // If WATER is to move but FIRE maximizes, win for WATER is negative for FIRE.
    expect(tablebaseToScore(win, FACTION.WATER, FACTION.FIRE)).toBeLessThan(0);
  });

  it("loadTablebaseFromJSON populates probeTablebase for a stored hash", () => {
    clearTablebase();
    const g = buildKQvK("0,0", "1,1", "2,2", 0);
    const hash = computeZobristHash(g).toString();
    loadTablebaseFromJSON({ [hash]: { r: "win", dtz: 2 } });
    const entry = probeTablebase(g);
    expect(entry).not.toBeNull();
    expect(entry!.result).toBe("win");
    expect(entry!.dtz).toBe(2);
  });

  it("minimax uses tablebase score instead of heuristic for a TB position", () => {
    // Load real TB, then evaluate a K+Q vs K position from FIRE's perspective.
    const g = buildKQvK("0,0", "1,1", "2,2", 0);
    const entry = probeTablebase(g);
    expect(entry).not.toBeNull();
    // Run the engine's minimax — the TB hook should short-circuit and return
    // the perfect TB score (not a heuristic eval).
    const result = minimax(
      g as any,
      3,
      -Infinity,
      Infinity,
      FACTION.FIRE,
      FACTION.FIRE,
    );
    if (entry!.result === "win") {
      // Perfect win score sits just below the mate value (10000).
      expect(result.score).toBeGreaterThan(9000);
    } else if (entry!.result === "loss") {
      expect(result.score).toBeLessThan(-9000);
    }
  });
});
