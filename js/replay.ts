/**
 * TriSchach Game Replay/Export System
 *
 * PGN-like format for 3-player hexagonal chess with RPS mechanics.
 *
 * Format: TSPN (TriSchach Portable Notation)
 * - Header tags: [Event "..."] [Site "..."] [Date "..."] [Round "..."]
 *   [White "Fire"] [Black "Water"] [Green "Nature"] [Result "..."] [RPS "on|off"]
 * - Moves: 1. fire_Pawn_-4,5 water_Pawn_0,2 2. nature_Pawn_-1,1 fire_Pawn_-4,4 ...
 *   Format: <moveNumber>. <faction>_<pieceId> <targetCoord> [<rpsResult>] [<special>]
 *   Special: =Q (promotion), x (capture), # (checkmate), + (check), !? (annotations)
 *
 * NOTE: Ported 1:1 from replay.js. Types are intentionally loose (`any`) to
 * match the original JS semantics and keep the migration mechanical.
 */

export const REPLAY_VERSION = "1.0";

import { Hex } from "./hex.ts";
import type { Faction, GameState } from "./types.ts";

// ─── Types ────────────────────────────────────────────────────────────────

/** Outcome of an RPS (rock-paper-scissors) tiebreak on a capture. */
export type RpsResult = string | null;

/**
 * Minimal structural shape of the pieces replay.ts reads from a game.
 * Matches both the live `Game` instance (which has fully-populated `Piece`
 * objects) and the lightweight mock pieces used in tests (where only
 * `type`/`faction` are required for notation formatting).
 */
export interface ReplayPiece {
  type: string;
  faction: Faction | string;
  id?: string;
  pos?: { q: number; r: number } | Hex;
  symbol?: string;
  alive?: boolean;
  hasMoved?: boolean;
}

/**
 * A single entry in a game's move history OR a move parsed from TSPN.
 * Real `Game` instances attach a live `piece` object; entries parsed from a
 * TSPN file carry `faction`, `pieceName` and `target` (the source square is
 * resolved at replay time, see resolveSourcePiece).
 */
export interface MoveHistoryEntry {
  piece?: ReplayPiece | null;
  to?: { q: number; r: number } | Hex | string | null;
  target?: { q: number; r: number } | Hex | string | null;
  action?: "move" | "combat" | "promotion" | "select" | "deselect" | string;
  faction?: Faction | string;
  pieceName?: string;
  rpsResult?: RpsResult;
  promotion?: boolean;
  promotionType?: string | null;
  inCheck?: boolean;
  check?: boolean;
  checkmate?: boolean | Faction;
  isCapture?: boolean;
  elimination?: Faction | string | null;
  result?: unknown;
  winner_faction?: Faction | string | null;
  san?: string;
  raw?: string;
}

/**
 * Structural view of a game that replay.ts consumes. Deliberately loose
 * (all fields optional) so that both the live `Game` instance and the
 * lightweight mock/serialized objects used in tests work without behavioural
 * change. Real `Game` instances satisfy this via structural typing.
 */
export interface GameLike {
  pieces?: ReplayPiece[];
  currentFaction?: Faction | string;
  currentFactionIdx?: number;
  state?: GameState | string;
  rpsEnabled?: boolean;
  eliminatedFactions?: Set<unknown> | Faction[] | string[];
  capturedPieces?: {
    fire: unknown[];
    water: unknown[];
    nature: unknown[];
  };
  moveHistory?: MoveHistoryEntry[];
  getAlivePieces?(game?: unknown): ReplayPiece[];
  getLegalMoves?(p: ReplayPiece): { moves: Hex[]; attacks: Hex[] };
  handleCellClick?(target: { q: number; r: number } | Hex): unknown;
  completePromotion?(type?: string): void;
  init?(cells: unknown): void;
}

/** Immutable snapshot yielded by the replay generator / controller. */
export interface ReplayStateSnapshot {
  pieces: Array<{
    id: string;
    type: string;
    faction: Faction | string;
    pos: { q: number; r: number };
    symbol: string;
    alive: boolean;
    hasMoved?: boolean;
  }>;
  currentFaction: Faction | string;
  currentFactionIdx: number;
  state: GameState | string;
  eliminatedFactions: (Faction | string)[];
  capturedPieces: { fire: string[]; water: string[]; nature: string[] };
  moveHistory: MoveHistoryEntry[];
}

export interface SerializeOptions {
  event?: string;
  site?: string;
  round?: string;
  result?: string;
  rpsEnabled?: boolean;
  includeComments?: boolean;
  // Additional PGN-style header overrides (e.g. Fire/Water/Nature/Date/Variant/Version).
  // serializeGame writes its own canonical headers but honors any override passed here.
  [header: string]: string | boolean | undefined;
}

/**
 * Serialize a game to TSPN format string.
 */
export function serializeGame(
  game: GameLike,
  options: SerializeOptions = {},
): string {
  const {
    event = "Casual Game",
    site = "TriSchach",
    round = "1",
    result = getResultString(game),
    rpsEnabled = game.rpsEnabled,
    includeComments = true,
    ...headerOverrides
  } = options;

  const lines: string[] = [];
  const date = new Date().toISOString().split("T")[0] ?? "";

  // Canonical headers in emission order. Any PGN-style override passed in
  // `options` (e.g. Fire/Water/Nature player names, a custom Date/Result)
  // replaces the default in place — honoring the SerializeOptions index
  // signature contract — without duplicating the header line.
  const headers: Array<[string, string]> = [
    ["Event", event],
    ["Site", site],
    ["Date", date],
    ["Round", round],
    ["Fire", "Player 1"],
    ["Water", "Player 2"],
    ["Nature", "Player 3"],
    ["Result", result],
    ["RPS", rpsEnabled ? "on" : "off"],
    ["Variant", "TriSchach"],
    ["Version", REPLAY_VERSION],
  ];

  const known = new Set(headers.map(([k]) => k));
  for (const [key, value] of headers) {
    const override = headerOverrides[key];
    const v = typeof override === "string" ? override : value;
    lines.push(`[${key} "${escapePGN(v)}"]`);
  }
  // Any extra override keys not in the canonical list are appended as headers.
  for (const [key, value] of Object.entries(headerOverrides)) {
    if (known.has(key) || typeof value !== "string") continue;
    lines.push(`[${key} "${escapePGN(value)}"]`);
  }
  lines.push("");

  // Move list
  const moveLines: string[] = [];
  let moveNumber = 1;
  let moveBuffer: string[] = [];

  const moveHistory = game.moveHistory || [];
  for (let i = 0; i < moveHistory.length; i++) {
    const move = moveHistory[i];
    if (!move) continue;
    const notation = formatMove(move, game, i);

    if (moveBuffer.length === 0) {
      moveBuffer.push(`${moveNumber}. ${notation}`);
    } else if (moveBuffer.length === 1) {
      moveBuffer.push(notation);
      moveLines.push(moveBuffer.join(" "));
      moveBuffer = [];
      moveNumber++;
    } else {
      // Third faction in round - start new line
      moveLines.push(moveBuffer.join(" ") + ` ${notation}`);
      moveBuffer = [];
      moveNumber++;
    }
  }

  // Flush remaining
  if (moveBuffer.length > 0) {
    moveLines.push(moveBuffer.join(" "));
  }

  // Wrap lines at ~80 chars
  for (const line of moveLines) {
    lines.push(...wrapLine(line, 80));
  }

  return lines.join("\n");
}

/**
 * Normalize a coordinate (Hex | {q,r} | "q,r" string) to a "q,r" string.
 */
function coordToString(
  coord: { q: number; r: number } | Hex | string | null | undefined,
): string {
  if (coord === null || coord === undefined) return "";
  if (typeof coord === "string") return coord;
  return `${coord.q},${coord.r}`;
}

/**
 * Format a single move for TSPN output.
 */
export function formatMove(
  move: MoveHistoryEntry,
  _game?: GameLike,
  moveIndex?: number,
): string {
  // Use 'to' for target position (move history uses 'to', not 'target')
  const target = move.to ?? move.target;

  // Handle promotion-only entries (no target)
  if (move.action === "promotion" || !target) {
    const PROMO_LETTER: Record<string, string> = {
      queen: "Q",
      rook: "R",
      bishop: "B",
      knight: "N",
    };
    const rawType = (move.promotionType || "queen").toString().toLowerCase();
    const promoType = PROMO_LETTER[rawType] ?? "Q";
    const factionPart = move.piece?.faction || move.faction || "unknown";
    return `${factionPart}_Promotion=${promoType}`;
  }

  const piece = move.piece;
  if (!piece) {
    const PROMO_LETTER2: Record<string, string> = {
      queen: "Q",
      rook: "R",
      bishop: "B",
      knight: "N",
    };
    const rawType2 = (move.promotionType || "queen").toString().toLowerCase();
    const promoType = PROMO_LETTER2[rawType2] ?? "Q";
    return `${move.faction || "unknown"}_Promotion=${promoType}`;
  }
  const faction = piece.faction;
  const pieceName = piece.type.charAt(0).toUpperCase() + piece.type.slice(1);

  // Coordinate notation: q,r
  const coord = coordToString(target);

  let notation = `${faction}_${pieceName}_${coord}`;

  // Add RPS result for captures
  if (move.action === "combat" && move.rpsResult) {
    const rpsSymbol =
      move.rpsResult === "advantage"
        ? ">"
        : move.rpsResult === "disadvantage"
          ? "<"
          : "=";
    notation += ` ${rpsSymbol}`;
  }

  // Add capture indicator (use _x_ before coordinates for clear parsing)
  if (move.action === "combat") {
    notation = notation.replace(`_${coord}`, `_x_${coord}`);
  }

  // Add promotion
  if (move.promotion) {
    notation += "=Q";
  }

  // Add check/checkmate
  if (move.checkmate) {
    notation += "#";
  } else if (move.inCheck) {
    notation += "+";
  }

  // Add elimination
  if (move.elimination) {
    notation += ` [${move.elimination} eliminated]`;
  }

  return notation;
}

/**
 * Get result string from game state.
 */
export function getResultString(game: GameLike): string {
  if (game.state !== "game_over") return "*";

  const history = game.moveHistory ?? [];
  const winner = history[history.length - 1]?.winner_faction;
  if (!winner) return "1/2-1/2-1/2"; // Draw (shouldn't happen in 3-player)

  // Map faction to result
  const results: Record<string, string> = {
    fire: "1-0-0",
    water: "0-1-0",
    nature: "0-0-1",
  };
  return results[winner] || "*";
}

/**
 * Escape string for PGN header.
 */
export function escapePGN(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}

/**
 * Wrap long line at maxLength.
 * Keeps words intact - if a single word exceeds maxLength, it stays on its own line.
 */
export function wrapLine(line: string, maxLength: number): string[] {
  if (line.length <= maxLength) return [line];

  const words = line.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    // If a single word is longer than maxLength, put it on its own line
    if (word.length > maxLength) {
      if (current) {
        lines.push(current.trim());
        current = "";
      }
      lines.push(word);
      continue;
    }

    if ((current + word).length > maxLength) {
      lines.push(current.trim());
      current = word + " ";
    } else {
      current += word + " ";
    }
  }
  if (current) lines.push(current.trim());

  return lines;
}

// ─── Deserialization ──────────────────────────────────────────────────────

interface ParsedMove {
  san?: string;
  raw?: string;
  faction?: string;
  pieceName?: string;
  target?: { q: number; r: number } | null;
  rpsResult?: string | null;
  promotion?: boolean;
  promotionType?: string | null;
  check?: boolean;
  checkmate?: boolean;
  isCapture?: boolean;
  elimination?: string | null;
}

interface ParsedTSPN {
  headers: Record<string, string>;
  moves: ParsedMove[];
  raw?: string;
}

/**
 * Parse a TSPN string and return game data for replay.
 * Returns { headers, moves, rawMoves }
 */
export function parseTSPN(tspnString: string): ParsedTSPN {
  const lines = tspnString.trim().split("\n");
  const headers: Record<string, string> = {};
  const moves: ParsedMove[] = [];
  let inMoves = false;
  let moveText = "";

  for (const line of lines) {
    const trimmed = line.trim();

    if (!inMoves) {
      // Parse headers
      const match = trimmed.match(/^\[(\w+)\s+"([^"]*)"\]$/);
      if (match) {
        headers[match[1]!] = match[2]!;
      } else if (trimmed === "") {
        inMoves = true;
      }
    } else {
      moveText += " " + trimmed;
    }
  }

  // Parse moves
  moveText = moveText.trim();
  if (moveText) {
    moves.push(...parseMoveText(moveText));
  }

  return { headers, moves, raw: moveText };
}

/**
 * Parse move text into structured move objects.
 * Handles RPS symbols that are space-separated from moves, and trailing
 * elimination annotations like "[nature eliminated]" that may contain spaces.
 */
export function parseMoveText(text: string): ParsedMove[] {
  const moves: ParsedMove[] = [];

  // Split into individual moves on move-number boundaries ("1.", "12.").
  // This supports both one-move-per-line TSPN and multiple moves in a single
  // line (legacy format). Each segment is "fire_Queen_x_0,1 > [nature eliminated]".
  const segments = text
    .split(/(?=\b\d+\.\s*)/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const seg of segments) {
    // Strip the leading move number ("1.", "12.").
    const withoutNumber = seg.replace(/^\d+\.\s*/, "");

    // Extract a trailing "[...]" elimination annotation as a single unit
    // (it may contain spaces, e.g. "[nature eliminated]") so it is NOT split
    // into separate tokens. parseMoveToken already strips trailing "[...]"
    // comments, so we save the faction and re-attach it below.
    let elimination: string | null = null;
    const annoMatch = withoutNumber.match(/\[([a-z]+)\s+eliminated\]\s*$/i);
    let movePart = withoutNumber;
    if (annoMatch) {
      elimination = annoMatch[1]!.toLowerCase();
      movePart = withoutNumber
        .replace(/\[([a-z]+)\s+eliminated\]\s*$/i, "")
        .trim();
    }

    const tokens = movePart.split(/\s+/).filter((t) => t);
    let i = 0;
    while (i < tokens.length) {
      const token = tokens[i]!;
      // Skip standalone comment annotations (already handled above, but be safe).
      if (token.startsWith("[") && token.endsWith("]")) {
        i++;
        continue;
      }
      // Append a standalone RPS symbol (>, <, =) to the move token.
      let fullToken = token;
      if (i + 1 < tokens.length) {
        const nextToken = tokens[i + 1]!;
        if (nextToken === ">" || nextToken === "<" || nextToken === "=") {
          fullToken = token + " " + nextToken;
          i++;
        }
      }
      const parsed = parseMoveToken(fullToken);
      if (elimination) parsed.elimination = elimination;
      moves.push(parsed);
      i++;
    }
  }

  return moves;
}

/**
 * Parse a single move token.
 * Format: faction_PieceName[_x]_q,r [><=] [=Q] [#+] [comments]
 * Examples:
 *   fire_Pawn_-4,5
 *   water_Pawn_x_-6,7 >
 *   nature_Pawn_-1,1 =
 *   fire_Pawn_0,0 =Q+
 */
export function parseMoveToken(token: string): ParsedMove {
  // Pattern: faction_PieceName[_x]_q,r [><=] [=Q] [#+]
  // Promotion pieces are encoded as a single letter (Q/R/B/N), matching the
  // TSPN writer in formatMove().

  const PROMO_MAP: Record<string, string> = {
    q: "queen",
    r: "rook",
    b: "bishop",
    n: "knight",
  };

  // Remove trailing comments [...] - but save for raw
  const cleanToken = token.replace(/\s*\[.*?\]\s*$/, "");

  // Handle promotions without coordinates first
  // Format: faction_PieceName_Promotion=Q/R/B/N OR faction_Promotion=Q/R/B/N
  const promoMatch = cleanToken.match(
    /^([a-zA-Z]+)_(.+?)_Promotion=(Q|R|B|N)$/,
  );
  if (promoMatch) {
    const pieceName = promoMatch[2]!.toLowerCase();
    return {
      san: cleanToken,
      raw: token,
      faction: promoMatch[1],
      pieceName: pieceName === "promotion" ? "promotion" : pieceName,
      target: null,
      rpsResult: null,
      promotion: true,
      promotionType: PROMO_MAP[promoMatch[3]!.toLowerCase()],
      check: false,
      checkmate: false,
      isCapture: false,
    };
  }

  // Also handle faction_Promotion=Q/R/B/N (no pieceName)
  const simplePromoMatch = cleanToken.match(
    /^([a-zA-Z]+)_Promotion=(Q|R|B|N)$/,
  );
  if (simplePromoMatch) {
    return {
      san: cleanToken,
      raw: token,
      faction: simplePromoMatch[1],
      pieceName: "promotion",
      target: null,
      rpsResult: null,
      promotion: true,
      promotionType: PROMO_MAP[simplePromoMatch[2]!.toLowerCase()],
      check: false,
      checkmate: false,
      isCapture: false,
    };
  }

  // Match: faction_PieceName(optional _x)_q,r [><=] [=Q] [#+]
  // Note: spaces before optional symbols are allowed
  // faction is letters only (not including _), pieceName can have _
  const match = cleanToken.match(
    /^([a-zA-Z]+)_(.+?)(?:_x)?_([+-]?\d+,[+-]?\d+)\s*([<=>=])?(=(Q|R|B|N))?([#+]?)?$/,
  );

  if (!match) {
    // Fallback for simple notation without coordinates
    return { san: token, raw: token };
  }

  const faction = match[1]!;
  const pieceName = match[2]!;
  const coord = match[3]!;
  const rpsSymbol = match[4];
  const promotion = match[5];
  const promotionType = match[5] ? match[6]!.toLowerCase() : null;
  const check = match[7];
  const rpsResult =
    rpsSymbol === ">"
      ? "advantage"
      : rpsSymbol === "<"
        ? "disadvantage"
        : rpsSymbol === "="
          ? "neutral"
          : null;

  // Check if this is a capture (has _x before coordinates)
  const fullMatch = cleanToken.match(
    /^([a-zA-Z]+)_(.+?)_x_([+-]?\d+,[+-]?\d+)/,
  );
  const isCapture = !!fullMatch;
  const [q, r] = coord.split(",").map(Number) as [number, number];

  return {
    san: cleanToken,
    raw: token,
    faction,
    pieceName: pieceName.toLowerCase(),
    target: { q, r },
    rpsResult,
    promotion: !!promotion,
    promotionType: promotion ? PROMO_MAP[promotionType!.toLowerCase()] : null,
    check: check === "+",
    checkmate: check === "#",
    isCapture,
  };
}

// ─── Replay Engine ────────────────────────────────────────────────────────

/**
 * Resolve the source piece for a replay move.
 *
 * In-memory move history entries carry a live `piece` object (with `pos`), but
 * moves loaded from a TSPN file via parseTSPN only have `faction`, `pieceName`
 * and `target` — the source square is NOT stored in the TSPN notation. To make
 * replaying saved games possible we resolve the source here: find the living
 * piece of the right faction/type whose legal moves include the target. If a
 * live `piece` is already present (in-memory path), it is used as-is.
 */
export function resolveSourcePiece(
  game: GameLike,
  move: MoveHistoryEntry & { pieceName?: string },
): ReplayPiece | null {
  if (move.piece && move.piece.pos) return move.piece;
  const target = move.target ?? move.to;
  if (!target || !move.faction || !move.pieceName) return null;

  const type = move.pieceName.toLowerCase();
  const alive: ReplayPiece[] =
    typeof game.getAlivePieces === "function"
      ? game.getAlivePieces()
      : (game.pieces ?? []).filter((p) => p.alive);
  const candidates = alive.filter(
    (p) => p.faction === move.faction && p.type === type,
  );

  for (const p of candidates) {
    // Mock-based callers (unit tests) may not implement getLegalMoves; in that
    // case fall back to the first candidate. Real Game instances resolve the
    // exact source by checking which candidate's legal moves include the target.
    if (typeof game.getLegalMoves !== "function") return candidates[0] ?? null;
    const { moves, attacks } = game.getLegalMoves(p);
    const hit = [...moves, ...attacks].some(
      (h) =>
        h.q === (target as { q: number }).q &&
        h.r === (target as { r: number }).r,
    );
    if (hit) return p;
  }
  return candidates[0] ?? null;
}

/**
 * Replay a game from move history.
 * Returns a generator that yields game states after each move.
 */
/**
 * A single yielded step of a replay: the cloned game state plus which move
 * produced it (null for the initial position at index -1).
 */
export interface ReplayStep {
  game: ReplayStateSnapshot;
  move: MoveHistoryEntry | null;
  index: number;
  result?: unknown;
}

/** Normalize a coordinate to a Hex, or null if it cannot be a board square. */
function toHexOrNull(
  coord: { q: number; r: number } | Hex | string | null | undefined,
): Hex | null {
  if (coord === null || coord === undefined) return null;
  if (typeof coord === "string") return null;
  return new Hex((coord as { q: number }).q, (coord as { r: number }).r);
}

export function* replayGame(
  initialGame: GameLike,
  moveHistory: MoveHistoryEntry[],
): Generator<ReplayStep> {
  const game = cloneGameForReplay(initialGame);
  yield { game: cloneGameState(game), move: null, index: -1 };

  for (let i = 0; i < moveHistory.length; i++) {
    const move = moveHistory[i];
    if (!move) continue;
    const piece = resolveSourcePiece(game, move);
    const target = toHexOrNull(move.target ?? move.to);

    // Execute move
    if (piece && target) {
      game.handleCellClick?.(piece.pos!);
      const result = game.handleCellClick?.(target) as {
        promotion?: unknown;
      } | null;

      if (result?.promotion && move.promotion) {
        game.completePromotion?.(move.promotionType || "queen");
      }
    }

    yield {
      game: cloneGameState(game),
      move,
      index: i,
      result: move.result || move,
    };
  }
}

/**
 * Create a replay controller for UI interaction.
 * Provides step-by-step control over replay.
 */
export class ReplayController {
  initialGame: GameLike;
  moveHistory: MoveHistoryEntry[];
  currentIndex: number;
  states: ReplayStateSnapshot[];

  constructor(initialGame: GameLike, moveHistory: MoveHistoryEntry[]) {
    this.initialGame = cloneGameForReplay(initialGame);
    this.moveHistory = moveHistory;
    this.currentIndex = -1;
    this.states = [];
    this.precomputeStates();
  }

  precomputeStates(): void {
    let game = cloneGameForReplay(this.initialGame);
    this.states = [cloneGameState(game)];

    for (const move of this.moveHistory) {
      if (!move) continue;
      const piece = resolveSourcePiece(game, move);
      const target = toHexOrNull(move.target ?? move.to);

      if (piece && target) {
        game.handleCellClick?.(piece.pos!);
        const result = game.handleCellClick?.(target) as {
          promotion?: unknown;
        } | null;

        if (result?.promotion && move.promotion) {
          game.completePromotion?.(move.promotionType || "queen");
        }
      }
      this.states.push(cloneGameState(game));
    }
  }

  getCurrentState(): ReplayStateSnapshot {
    return this.states[this.currentIndex + 1] ?? this.states[0]!;
  }

  getCurrentMove(): MoveHistoryEntry | null {
    return this.moveHistory[this.currentIndex] || null;
  }

  canGoForward(): boolean {
    return this.currentIndex < this.moveHistory.length - 1;
  }

  canGoBack(): boolean {
    return this.currentIndex >= 0;
  }

  next(): ReplayStateSnapshot | null {
    if (this.canGoForward()) {
      this.currentIndex++;
      return this.getCurrentState();
    }
    return null;
  }

  previous(): ReplayStateSnapshot | null {
    if (this.canGoBack()) {
      this.currentIndex--;
      return this.getCurrentState();
    }
    return null;
  }

  goTo(index: number): ReplayStateSnapshot | null {
    if (index >= -1 && index < this.moveHistory.length) {
      this.currentIndex = index;
      return this.getCurrentState();
    }
    return null;
  }

  goToStart(): ReplayStateSnapshot | null {
    this.currentIndex = -1;
    return this.getCurrentState();
  }

  goToEnd(): ReplayStateSnapshot | null {
    this.currentIndex = this.moveHistory.length - 1;
    return this.getCurrentState();
  }

  getTotalMoves(): number {
    return this.moveHistory.length;
  }

  getCurrentMoveNumber(): number {
    return this.currentIndex + 1;
  }

  /** Export current game state as TSPN string (including all moves played so far) */
  exportTSPN(headers: Record<string, string> = {}): string {
    // Reconstruct a temporary game to serialize
    const tempGame: GameLike = {
      pieces: (this.initialGame.pieces ?? []).map((p) => ({ ...p })),
      currentFaction: this.initialGame.currentFaction,
      currentFactionIdx: this.initialGame.currentFactionIdx,
      state: this.initialGame.state,
      eliminatedFactions: new Set(this.initialGame.eliminatedFactions ?? []),
      rpsEnabled: this.initialGame.rpsEnabled,
      moveHistory: this.moveHistory.slice(0, this.currentIndex + 1),
    };

    const defaultHeaders = {
      Event: "TriSchach Game",
      Site: "Local",
      Date: new Date().toISOString().split("T")[0],
      Round: "1",
      White: "Fire",
      Black: "Water",
      Green: "Nature",
      Result: "*",
      RPS: tempGame.rpsEnabled ? "on" : "off",
      Variant: "TriSchach",
      Version: "1.0",
    };

    const allHeaders = { ...defaultHeaders, ...headers };
    return serializeGame(tempGame, { ...headers, ...allHeaders });
  }

  /** Export the complete game as TSPN string (all moves from start to finish) */
  exportTSPNFull(headers: Record<string, string> = {}): string {
    const tempGame: GameLike = {
      pieces: (this.initialGame.pieces ?? []).map((p) => ({ ...p })),
      currentFaction: this.initialGame.currentFaction,
      currentFactionIdx: this.initialGame.currentFactionIdx,
      state: "game_over",
      eliminatedFactions: new Set(this.initialGame.eliminatedFactions ?? []),
      rpsEnabled: this.initialGame.rpsEnabled,
      moveHistory: this.moveHistory, // ALL moves
    };

    const defaultHeaders = {
      Event: "TriSchach Game",
      Site: "Local",
      Date: new Date().toISOString().split("T")[0],
      Round: "1",
      White: "Fire",
      Black: "Water",
      Green: "Nature",
      Result: "*",
      RPS: tempGame.rpsEnabled ? "on" : "off",
      Variant: "TriSchach",
      Version: "1.0",
    };

    const allHeaders = { ...defaultHeaders, ...headers };
    return serializeGame(tempGame, { ...headers, ...allHeaders });
  }
}

/**
 * Clone game for replay (immutable snapshot).
 */
export function cloneGameForReplay(game: GameLike): GameLike {
  // Create a fresh game and replay all moves
  // For now, return the game - in practice would create fresh Game instance
  return game;
}

/**
 * Clone game state for yield.
 */
export function cloneGameState(game: GameLike): ReplayStateSnapshot {
  const pieces =
    game.pieces?.map((p) => ({
      id: p.id ?? "",
      type: p.type,
      faction: p.faction,
      pos: { q: (p.pos as { q: number }).q, r: (p.pos as { r: number }).r },
      symbol: p.symbol ?? "",
      alive: p.alive ?? true,
      hasMoved: p.hasMoved,
    })) ?? [];
  return {
    pieces,
    currentFaction: game.currentFaction ?? "",
    currentFactionIdx: game.currentFactionIdx ?? 0,
    state: game.state ?? "",
    eliminatedFactions: Array.from(
      game.eliminatedFactions ?? [],
    ) as unknown as (Faction | string)[],
    capturedPieces: {
      fire: (game.capturedPieces?.fire ?? []).map((p) =>
        typeof p === "object" && p !== null && "id" in p
          ? (p as { id: string }).id
          : (p as string),
      ),
      water: (game.capturedPieces?.water ?? []).map((p) =>
        typeof p === "object" && p !== null && "id" in p
          ? (p as { id: string }).id
          : (p as string),
      ),
      nature: (game.capturedPieces?.nature ?? []).map((p) =>
        typeof p === "object" && p !== null && "id" in p
          ? (p as { id: string }).id
          : (p as string),
      ),
    },
    moveHistory: game.moveHistory ?? [],
  };
}

/**
 * Reconstruct a game from TSPN headers and moves.
 * Creates a fresh Game instance and replays all moves.
 */
export function reconstructGameFromTSPN(
  parsedTSPN: ParsedTSPN,
  GameClass: new () => GameLike,
  boardCells: unknown,
): { game: GameLike; controller: ReplayController } {
  const game = new GameClass();
  game.init?.(boardCells);

  // Apply RPS setting from headers
  const rpsHeader = parsedTSPN.headers?.RPS?.toLowerCase();
  game.rpsEnabled = rpsHeader !== "off";

  const controller = new ReplayController(game, parsedTSPN.moves);

  return { game, controller };
}

// ─── Export/Import Helpers ────────────────────────────────────────────────

/**
 * Download game as .tspn file.
 */
export function downloadGame(
  game: GameLike,
  filename: string | null = null,
): void {
  const tspn = serializeGame(game);
  const blob = new Blob([tspn], { type: "text/plain" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download =
    filename || `trischach-${new Date().toISOString().slice(0, 10)}.tspn`;
  a.click();

  URL.revokeObjectURL(url);
}

/**
 * Copy game to clipboard.
 */
export async function copyGameToClipboard(game: GameLike): Promise<void> {
  const tspn = serializeGame(game);
  await navigator.clipboard.writeText(tspn);
}

/**
 * Load game from file.
 */
export function loadGameFromFile(file: File): Promise<ParsedTSPN> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = parseTSPN(e.target?.result as string);
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/**
 * Load game from TSPN string.
 */
export function loadGameFromString(tspnString: string): ParsedTSPN {
  return parseTSPN(tspnString);
}

// Re-export ParsedTSPN type alias for callers expecting it
export type { ParsedTSPN };
