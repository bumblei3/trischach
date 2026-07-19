/**
 * Invariant tests for `explainRPS` (js/analysis.ts).
 *
 * This is the human-readable RPS rationale shown to the player in analysis /
 * coach mode — it MUST classify the RPS cycle correctly (advantage / disadvantage
 * / neutral) and never invert it, or the UI would coach the player into a losing
 * exchange. These tests assert the *meaning* of the output (which cycle branch
 * fires), not just that a string is returned.
 */
import { describe, it, expect } from "vitest";
import { explainRPS } from "../js/analysis.ts";
import { Game } from "../js/game.ts";
import { generateBoard, FACTION } from "../js/board.ts";
import { Piece } from "../js/pieces.ts";
import { Hex } from "../js/hex.ts";
import type { AIAction, Faction } from "../js/types.ts";

/** Build a minimal 2-faction game with pieces on the given cells. */
function buildGame(
  specs: { type: string; faction: Faction; key: string }[],
): Game {
  const boardCells = generateBoard();
  const g = new Game();
  g.init(boardCells as never);
  g.pieces = [];
  g.eliminatedFactions = new Set<Faction>([FACTION.NATURE]); // only FIRE+WATER alive
  for (const s of specs) {
    g.pieces.push(
      new Piece(s.type as never, s.faction, boardCells.get(s.key)!.hex),
    );
  }
  g.currentFactionIdx = 0;
  g.currentFaction = FACTION.FIRE;
  g._rebuildOccupiedMap();
  return g;
}

function attackAction(
  from: string,
  to: string,
  faction: Faction,
  type = "pawn",
): AIAction {
  const boardCells = generateBoard();
  return {
    piece: {
      type: type as never,
      faction,
      pos: boardCells.get(from)!.hex,
    } as never,
    target: boardCells.get(to)!.hex,
    type: "attack",
  } as AIAction;
}

function moveAction(
  from: string,
  to: string,
  faction: Faction,
  type = "pawn",
): AIAction {
  const boardCells = generateBoard();
  return {
    piece: {
      type: type as never,
      faction,
      pos: boardCells.get(from)!.hex,
    } as never,
    target: boardCells.get(to)!.hex,
    type: "move",
  } as AIAction;
}

describe("explainRPS — attack moves classify the RPS cycle", () => {
  it("advantage attack (Fire→Nature) reports Vorteil, never Risk", () => {
    const g = buildGame([
      { type: "pawn", faction: FACTION.FIRE, key: "0,0" },
      { type: "pawn", faction: FACTION.NATURE, key: "0,1" },
    ]);
    const out = explainRPS(g, attackAction("0,0", "0,1", FACTION.FIRE));
    expect(out).not.toBeNull();
    expect(out).toContain("Vorteil");
    expect(out).not.toContain("Risiko");
    expect(out).not.toContain("Nachteil");
  });

  it("disadvantage attack (Fire→Water) reports Risk/Nachteil, never Vorteil", () => {
    const g = buildGame([
      { type: "pawn", faction: FACTION.FIRE, key: "0,0" },
      { type: "pawn", faction: FACTION.WATER, key: "0,1" },
    ]);
    const out = explainRPS(g, attackAction("0,0", "0,1", FACTION.FIRE));
    expect(out).not.toBeNull();
    expect(out).toMatch(/Risiko|Nachteil/);
    expect(out).not.toContain("Vorteil");
  });

  it("neutral attack (same faction) reports neutral, not Vorteil/Risiko", () => {
    const g = buildGame([
      { type: "pawn", faction: FACTION.FIRE, key: "0,0" },
      { type: "pawn", faction: FACTION.FIRE, key: "0,1" },
    ]);
    const out = explainRPS(g, attackAction("0,0", "0,1", FACTION.FIRE));
    expect(out).not.toBeNull();
    expect(out).toContain("neutral");
    expect(out).not.toContain("Vorteil");
    expect(out).not.toContain("Risiko");
  });

  it("attack on empty target returns null (no piece to classify)", () => {
    const g = buildGame([
      { type: "pawn", faction: FACTION.FIRE, key: "0,0" },
      { type: "pawn", faction: FACTION.WATER, key: "0,2" },
    ]);
    // target 0,1 is empty
    const out = explainRPS(g, attackAction("0,0", "0,1", FACTION.FIRE));
    expect(out).toBeNull();
  });
});

describe("explainRPS — non-attack moves summarise the side's RPS standing", () => {
  it("side that beats a living faction reports 'schlägst X'", () => {
    // FIRE beats NATURE; NATURE alive → advantage branch.
    const g = buildGame([
      { type: "pawn", faction: FACTION.FIRE, key: "0,0" },
      { type: "pawn", faction: FACTION.NATURE, key: "0,1" },
      { type: "king", faction: FACTION.WATER, key: "0,2" },
    ]);
    const out = explainRPS(g, moveAction("0,0", "0,1", FACTION.FIRE));
    expect(out).not.toBeNull();
    expect(out).toContain("schlägst");
    expect(out).toContain("Natur");
  });

  it("side that loses to a living faction reports 'unterliegst X'", () => {
    // FIRE loses to WATER; WATER alive → disadvantage branch.
    const g = buildGame([
      { type: "pawn", faction: FACTION.FIRE, key: "0,0" },
      { type: "king", faction: FACTION.WATER, key: "0,1" },
      { type: "pawn", faction: FACTION.NATURE, key: "0,2" },
    ]);
    const out = explainRPS(g, moveAction("0,0", "0,1", FACTION.FIRE));
    expect(out).not.toBeNull();
    expect(out).toContain("unterliegst");
    expect(out).toContain("Wasser");
  });

  it("balanced RPS standing across living factions reports 'ausgeglichen'", () => {
    // FIRE alive alone with only NATURE eliminated → no adv/dis living faction
    // other than the side itself. FIRE vs WATER: FIRE loses (dis). To get a
    // balanced report we need the only OTHER living faction to be one FIRE
    // neither beats nor loses to — but the cycle is total, so instead remove
    // the other living faction by eliminating it. Here: FIRE + (eliminated WATER)
    // leaves only FIRE among the living → no adv/dis → 'ausgeglichen'.
    const g = buildGame([{ type: "pawn", faction: FACTION.FIRE, key: "0,0" }]);
    g.eliminatedFactions = new Set<Faction>([FACTION.WATER, FACTION.NATURE]);
    const out = explainRPS(g, moveAction("0,0", "0,1", FACTION.FIRE));
    expect(out).not.toBeNull();
    expect(out).toContain("ausgeglichen");
  });
});
