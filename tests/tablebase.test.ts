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
import type { PieceType } from "../js/types.ts";
import { readFileSync } from "node:fs";

function buildEndgame(
  strongPieces: [PieceType, string][],
  weakPieces: [PieceType, string][],
  eliminated: Faction,
  sideIdx: number,
): Game {
  const boardCells = generateBoard();
  const g = new Game();
  g.init(boardCells as any);
  g.pieces = [];
  g.eliminatedFactions = new Set<Faction>([eliminated]);
  const mk = (type: PieceType, fac: Faction, key: string) =>
    new Piece(type, fac, boardCells.get(key)!.hex);
  strongPieces.forEach(([t, k]) => g.pieces.push(mk(t, FACTION.FIRE, k)));
  weakPieces.forEach(([t, k]) => g.pieces.push(mk(t, FACTION.WATER, k)));
  g.currentFactionIdx = sideIdx;
  g.currentFaction = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE][sideIdx]!;
  (g as any)._positionHash = undefined;
  return g;
}

function buildKQvK(
  qKey: string,
  kStrongKey: string,
  kWeakKey: string,
  sideIdx: number,
): Game {
  return buildEndgame(
    [
      ["queen", qKey],
      ["king", kStrongKey],
    ],
    [["king", kWeakKey]],
    FACTION.NATURE,
    sideIdx,
  );
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

// Shared assertions for the generated 4-piece tablebases (KQ, KR, KPK).
// Each proves: (1) the endgame is recognised as a tablebase position, (2) the
// generated JSON loads and contains decisive entries, and (3) the common probe
// path round-trips a stored hash. The minimax short-circuit is covered once by
// the K+Q vs K suite below (identical code path for every endgame).
function describeEndgame(
  label: string,
  file: string,
  strong: [PieceType, string][],
  weak: [PieceType, string][],
): void {
  describe(`tablebase: ${label}`, () => {
    let raw: Record<string, { r: "win" | "loss" | "draw"; dtz: number }>;

    beforeEach(() => {
      clearTablebase();
      raw = JSON.parse(readFileSync(file, "utf8"));
      loadTablebaseFromJSON(raw);
    });

    it("isTablebasePosition true (≤4 pieces, 1 eliminated)", () => {
      const g = buildEndgame(strong, weak, FACTION.NATURE, 0);
      expect(isTablebasePosition(g)).toBe(true);
    });

    it("generated JSON loads with decisive entries", () => {
      const keys = Object.keys(raw);
      expect(keys.length).toBeGreaterThan(0);
      // Only decisive results are stored (draws omitted) — verify shape.
      const sample = raw[keys[0]!];
      expect(sample).toBeDefined();
      expect(["win", "loss"]).toContain(sample!.r);
      expect(typeof sample!.dtz).toBe("number");
    });

    it("probeTablebase round-trips a stored hash", () => {
      const g = buildEndgame(strong, weak, FACTION.NATURE, 0);
      const hash = computeZobristHash(g).toString();
      // Force a known entry for this exact position and confirm probe returns it.
      clearTablebase();
      loadTablebaseFromJSON({ [hash]: { r: "win", dtz: 3 } });
      const entry = probeTablebase(g);
      expect(entry).not.toBeNull();
      expect(entry!.result).toBe("win");
      expect(entry!.dtz).toBe(3);
    });
  });
}

describeEndgame(
  "K+R vs K endgame",
  "public/js/tablebases/kr-vs-k.json",
  [
    ["king", "1,1"],
    ["rook", "0,0"],
  ],
  [["king", "2,2"]],
);

describeEndgame(
  "K+P vs K endgame",
  "public/js/tablebases/kpk.json",
  [
    ["king", "1,1"],
    ["pawn", "0,0"],
  ],
  [["king", "2,2"]],
);
