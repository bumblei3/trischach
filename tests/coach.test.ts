import { describe, it, expect } from "vitest";
import { Hex } from "../js/hex.ts";
import {
  describeRps,
  getCoachMessage,
  isDisadvantageHex,
  rpsCaptureTitle,
  rpsCaptureTitleFromPieces,
} from "../js/coach.ts";
import type { Piece } from "../js/types.ts";

describe("coach RPS helpers", () => {
  it("describeRps labels outcomes", () => {
    expect(describeRps("advantage")).toMatch(/Vorteil/i);
    expect(describeRps("disadvantage")).toMatch(/Nachteil|stirbst/i);
    expect(describeRps("neutral")).toMatch(/Neutral/i);
  });

  it("rpsCaptureTitle includes factions and outcome", () => {
    const t = rpsCaptureTitle("fire", "nature", "advantage");
    expect(t).toMatch(/🔥/);
    expect(t).toMatch(/🌿/);
    expect(t).toMatch(/Vorteil/i);
  });

  it("rpsCaptureTitleFromPieces uses RPS cycle (fire beats nature)", () => {
    const a = { faction: "fire" } as Piece;
    const d = { faction: "nature" } as Piece;
    expect(rpsCaptureTitleFromPieces(a, d)).toMatch(/Vorteil/i);
    const bad = rpsCaptureTitleFromPieces(
      { faction: "fire" } as Piece,
      { faction: "water" } as Piece,
    );
    expect(bad).toMatch(/Nachteil|stirbst/i);
  });

  it("isDisadvantageHex matches keys", () => {
    const h = new Hex(1, 2);
    const buckets = {
      advantage: [],
      neutral: [],
      disadvantage: [h],
    };
    expect(isDisadvantageHex(new Hex(1, 2), buckets)).toBe(true);
    expect(isDisadvantageHex(new Hex(0, 0), buckets)).toBe(false);
    expect(isDisadvantageHex(h, null)).toBe(false);
  });
});

describe("getCoachMessage", () => {
  const base = {
    currentFaction: "fire" as const,
    rpsEnabled: true,
    selectedPiece: null as Piece | null,
    validMoves: [] as Hex[],
    validAttacks: [] as Hex[],
    isKingInCheck: () => false,
    getPieceAt: () => null,
  };

  it("asks to select a piece", () => {
    const msg = getCoachMessage({ ...base, state: "select_piece" });
    expect(msg.text).toMatch(/Figur/i);
    expect(msg.tone).toBe("info");
  });

  it("warns on check", () => {
    const msg = getCoachMessage({
      ...base,
      state: "select_piece",
      isKingInCheck: () => true,
    });
    expect(msg.tone).toBe("check");
    expect(msg.text).toMatch(/Schach/i);
  });

  it("warns when only disadvantage captures exist", () => {
    const attacker = {
      faction: "fire",
      type: "queen",
      pos: new Hex(0, 0),
    } as Piece;
    const enemy = {
      faction: "water",
      type: "pawn",
      pos: new Hex(1, 0),
    } as Piece;
    const atkHex = new Hex(1, 0);
    const msg = getCoachMessage({
      ...base,
      state: "select_target",
      selectedPiece: attacker,
      validMoves: [new Hex(0, 1)],
      validAttacks: [atkHex],
      getPieceAt: (h: Hex) => (h.equals(atkHex) ? enemy : null),
    });
    expect(msg.tone).toBe("rps-bad");
    expect(msg.text).toMatch(/stirbst|rot/i);
  });

  it("praises advantage captures", () => {
    const attacker = {
      faction: "fire",
      type: "queen",
      pos: new Hex(0, 0),
    } as Piece;
    const prey = {
      faction: "nature",
      type: "pawn",
      pos: new Hex(1, 0),
    } as Piece;
    const atkHex = new Hex(1, 0);
    const msg = getCoachMessage({
      ...base,
      state: "select_target",
      selectedPiece: attacker,
      validMoves: [],
      validAttacks: [atkHex],
      getPieceAt: (h: Hex) => (h.equals(atkHex) ? prey : null),
    });
    expect(msg.tone).toBe("rps-good");
    expect(msg.text).toMatch(/günstig|grün/i);
  });

  it("reports game over regardless of other conditions", () => {
    const msg = getCoachMessage({
      ...base,
      state: "game_over",
      isKingInCheck: () => true,
    });
    expect(msg.tone).toBe("info");
    expect(msg.text).toBe("Partie beendet");
  });

  it("shows thinking message when the current faction is an AI faction", () => {
    const msg = getCoachMessage({
      ...base,
      state: "select_piece",
      isAIFaction: (f) => f === "fire",
    });
    expect(msg.tone).toBe("info");
    expect(msg.text).toMatch(/denkt/);
    // The AI branch takes precedence over check.
    expect(msg.text).not.toMatch(/Schach/);
  });

  it("asks for a promotion choice", () => {
    const msg = getCoachMessage({ ...base, state: "promotion" });
    expect(msg.tone).toBe("info");
    expect(msg.text).toMatch(/Umwandlung/i);
    expect(msg.text).toMatch(/Q\/R\/B\/N/);
  });

  it("warns when the selected piece has no legal moves at all", () => {
    const attacker = {
      faction: "fire",
      type: "pawn",
      pos: new Hex(0, 0),
    } as Piece;
    const msg = getCoachMessage({
      ...base,
      state: "select_target",
      selectedPiece: attacker,
      rpsEnabled: false,
      validMoves: [],
      validAttacks: [],
    });
    expect(msg.tone).toBe("warn");
    expect(msg.text).toMatch(/Keine legalen Züge/);
  });

  it("falls back to a plain target prompt for mixed advantage+disadvantage attacks (rps enabled)", () => {
    // fire queen attacking both nature (advantage) and water (disadvantage)
    const advHex = new Hex(1, 0);
    const disHex = new Hex(-1, 1);
    const msg = getCoachMessage({
      ...base,
      state: "select_target",
      selectedPiece: { faction: "fire" } as Piece,
      validMoves: [new Hex(0, 1)],
      validAttacks: [advHex, disHex],
      getPieceAt: (h: Hex) =>
        h.equals(advHex)
          ? ({ faction: "nature" } as Piece)
          : h.equals(disHex)
            ? ({ faction: "water" } as Piece)
            : null,
    });
    expect(msg.tone).toBe("rps-bad");
    expect(msg.text).toMatch(/grün/);
    expect(msg.text).toMatch(/rot/);
    expect(msg.text).toContain("1 Züge");
  });

  it("uses plain counts when RPS is disabled even with attacks present", () => {
    const atkHex = new Hex(1, 0);
    const msg = getCoachMessage({
      ...base,
      state: "select_target",
      rpsEnabled: false,
      selectedPiece: { faction: "fire" } as Piece,
      validMoves: [new Hex(0, 1), new Hex(1, -1)],
      validAttacks: [atkHex],
      getPieceAt: (h: Hex) =>
        h.equals(atkHex) ? ({ faction: "nature" } as Piece) : null,
    });
    expect(msg.tone).toBe("info");
    expect(msg.text).toContain("2 Züge · 1 Angriffe");
  });

  it("falls through to the turn fallback for unknown states", () => {
    const msg = getCoachMessage({
      ...base,
      state: "some_future_state" as never,
    });
    expect(msg.tone).toBe("info");
    expect(msg.text).toMatch(/am Zug/);
  });
});
