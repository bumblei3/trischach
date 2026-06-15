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
 */

export const REPLAY_VERSION = "1.0";

// ─── Serialization ────────────────────────────────────────────────────────

/**
 * Serialize a game to TSPN format string.
 */
export function serializeGame(game, options = {}) {
  const {
    event = "Casual Game",
    site = "TriSchach",
    round = "1",
    result = getResultString(game),
    rpsEnabled = game.rpsEnabled,
    includeComments = true,
  } = options;

  const lines = [];
  const date = new Date().toISOString().split("T")[0];

  // Headers
  lines.push(`[Event "${escapePGN(event)}"]`);
  lines.push(`[Site "${escapePGN(site)}"]`);
  lines.push(`[Date "${date}"]`);
  lines.push(`[Round "${escapePGN(round)}"]`);
  lines.push(`[Fire "Player 1"]`);
  lines.push(`[Water "Player 2"]`);
  lines.push(`[Nature "Player 3"]`);
  lines.push(`[Result "${result}"]`);
  lines.push(`[RPS "${rpsEnabled ? "on" : "off"}"]`);
  lines.push(`[Variant "TriSchach"]`);
  lines.push(`[Version "${REPLAY_VERSION}"]`);
  lines.push("");

  // Move list
  const moveLines = [];
  let moveNumber = 1;
  let moveBuffer = [];

  for (let i = 0; i < game.moveHistory.length; i++) {
    const move = game.moveHistory[i];
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
 * Format a single move for TSPN output.
 */
export function formatMove(move, game, moveIndex) {
  // Use 'to' for target position (move history uses 'to', not 'target')
  const target = move.to;

  // Handle promotion-only entries (no target)
  if (move.action === "promotion" || !target) {
    return `${move.piece?.faction || "unknown"}_Promotion=Q`;
  }

  const piece = move.piece;
  const faction = piece.faction;
  const pieceName = piece.type.charAt(0).toUpperCase() + piece.type.slice(1);

  // Coordinate notation: q,r
  const coord = `${target.q},${target.r}`;

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
export function getResultString(game) {
  if (game.state !== "game_over") return "*";

  const winner = game.moveHistory[game.moveHistory.length - 1]?.winner_faction;
  if (!winner) return "1/2-1/2-1/2"; // Draw (shouldn't happen in 3-player)

  // Map faction to result
  const results = {
    fire: "1-0-0",
    water: "0-1-0",
    nature: "0-0-1",
  };
  return results[winner] || "*";
}

/**
 * Escape string for PGN header.
 */
export function escapePGN(str) {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}

/**
 * Wrap long line at maxLength.
 * Keeps words intact - if a single word exceeds maxLength, it stays on its own line.
 */
export function wrapLine(line, maxLength) {
  if (line.length <= maxLength) return [line];

  const words = line.split(" ");
  const lines = [];
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

/**
 * Parse a TSPN string and return game data for replay.
 * Returns { headers, moves, rawMoves }
 */
export function parseTSPN(tspnString) {
  const lines = tspnString.trim().split("\n");
  const headers = {};
  const moves = [];
  let inMoves = false;
  let moveText = "";

  for (const line of lines) {
    const trimmed = line.trim();

    if (!inMoves) {
      // Parse headers
      const match = trimmed.match(/^\[(\w+)\s+"([^"]*)"\]$/);
      if (match) {
        headers[match[1]] = match[2];
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
 * Handles RPS symbols that are space-separated from moves.
 */
export function parseMoveText(text) {
  // Remove move numbers (1., 2., etc.)
  const cleaned = text.replace(/\d+\.\s*/g, "");
  const tokens = cleaned.split(/\s+/).filter((t) => t);

  const moves = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    // Skip comment annotations
    if (token.startsWith("[") && token.endsWith("]")) {
      i++;
      continue;
    }

    // Check if next token is an RPS symbol (standalone > < =)
    // If so, append it to current token for parseMoveToken
    let fullToken = token;
    if (i + 1 < tokens.length) {
      const nextToken = tokens[i + 1];
      if (nextToken === ">" || nextToken === "<" || nextToken === "=") {
        fullToken = token + " " + nextToken;
        i++; // consume RPS symbol
      }
    }

    moves.push(parseMoveToken(fullToken));
    i++;
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
export function parseMoveToken(token) {
  // Pattern: faction_PieceName[_x]_q,r [><=] [=Q] [#+] [comments]
  // Capture groups: faction, pieceName, isCapture, coord, rpsSymbol, promotion, check, comment

  // Remove trailing comments [...] - but save for raw
  const cleanToken = token.replace(/\s*\[.*?\]\s*$/, "");

  // Handle promotions without coordinates first
  // Format: faction_PieceName_Promotion=Q OR faction_Promotion=Q
  const promoMatch = cleanToken.match(/^([a-zA-Z]+)_(.+?)_Promotion=Q$/);
  if (promoMatch) {
    const pieceName = promoMatch[2].toLowerCase();
    return {
      san: cleanToken,
      raw: token,
      faction: promoMatch[1],
      pieceName: pieceName === "promotion" ? "promotion" : pieceName,
      target: null,
      rpsResult: null,
      promotion: true,
      promotionType: "queen",
      check: false,
      checkmate: false,
      isCapture: false,
    };
  }

  // Also handle faction_Promotion=Q (no pieceName)
  const simplePromoMatch = cleanToken.match(/^([a-zA-Z]+)_Promotion=Q$/);
  if (simplePromoMatch) {
    return {
      san: cleanToken,
      raw: token,
      faction: simplePromoMatch[1],
      pieceName: "promotion",
      target: null,
      rpsResult: null,
      promotion: true,
      promotionType: "queen",
      check: false,
      checkmate: false,
      isCapture: false,
    };
  }

  // Match: faction_PieceName(optional _x)_q,r [><=] [=Q] [#+]
  // Note: spaces before optional symbols are allowed
  // faction is letters only (not including _), pieceName can have _
  const match = cleanToken.match(
    /^([a-zA-Z]+)_(.+?)(?:_x)?_([+-]?\d+,[+-]?\d+)\s*([<=>=])?(=Q)?([#+]?)?$/,
  );

  if (!match) {
    // Fallback for simple notation without coordinates
    return { san: token, raw: token };
  }

  const [, faction, pieceName, coord, rpsSymbol, promotion, check] = match;
  const [q, r] = coord.split(",").map(Number);

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

  return {
    san: cleanToken,
    raw: token,
    faction,
    pieceName: pieceName.toLowerCase(),
    target: { q: parseInt(q), r: parseInt(r) },
    rpsResult,
    promotion: !!promotion,
    promotionType: promotion ? "queen" : null,
    check: check === "+",
    checkmate: check === "#",
    isCapture,
  };
}

// ─── Replay Engine ────────────────────────────────────────────────────────

/**
 * Replay a game from move history.
 * Returns a generator that yields game states after each move.
 */
export function* replayGame(initialGame, moveHistory) {
  const game = cloneGameForReplay(initialGame);
  yield { game: cloneGameState(game), move: null, index: -1 };

  for (let i = 0; i < moveHistory.length; i++) {
    const move = moveHistory[i];

    // Execute move
    if (move.piece && move.target) {
      game.handleCellClick(move.piece.pos);
      const result = game.handleCellClick(move.target);

      if (result.promotion && move.promotion) {
        game.completePromotion(move.promotionType || "queen");
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
  constructor(initialGame, moveHistory) {
    this.initialGame = cloneGameForReplay(initialGame);
    this.moveHistory = moveHistory;
    this.currentIndex = -1;
    this.states = [];
    this.precomputeStates();
  }

  precomputeStates() {
    let game = cloneGameForReplay(this.initialGame);
    this.states = [cloneGameState(game)];

    for (const move of this.moveHistory) {
      if (move.piece && move.target) {
        game.handleCellClick(move.piece.pos);
        const result = game.handleCellClick(move.target);

        if (result.promotion && move.promotion) {
          game.completePromotion(move.promotionType || "queen");
        }
      }
      this.states.push(cloneGameState(game));
    }
  }

  getCurrentState() {
    return this.states[this.currentIndex + 1] || this.states[0];
  }

  getCurrentMove() {
    return this.moveHistory[this.currentIndex] || null;
  }

  canGoForward() {
    return this.currentIndex < this.moveHistory.length - 1;
  }

  canGoBack() {
    return this.currentIndex >= 0;
  }

  next() {
    if (this.canGoForward()) {
      this.currentIndex++;
      return this.getCurrentState();
    }
    return null;
  }

  previous() {
    if (this.canGoBack()) {
      this.currentIndex--;
      return this.getCurrentState();
    }
    return null;
  }

  goTo(index) {
    if (index >= -1 && index < this.moveHistory.length) {
      this.currentIndex = index;
      return this.getCurrentState();
    }
    return null;
  }

  goToStart() {
    this.currentIndex = -1;
    return this.getCurrentState();
  }

  goToEnd() {
    this.currentIndex = this.moveHistory.length - 1;
    return this.getCurrentState();
  }

  getTotalMoves() {
    return this.moveHistory.length;
  }

  getCurrentMoveNumber() {
    return this.currentIndex + 1;
  }

  /** Export current game state as TSPN string (including all moves played so far) */
  exportTSPN(headers = {}) {
    // Reconstruct a temporary game to serialize
    const tempGame = {
      pieces: this.initialGame.pieces.map((p) => ({ ...p })),
      currentFaction: this.initialGame.currentFaction,
      currentFactionIdx: this.initialGame.currentFactionIdx,
      state: this.initialGame.state,
      eliminatedFactions: new Set(this.initialGame.eliminatedFactions),
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
  exportTSPNFull(headers = {}) {
    const tempGame = {
      pieces: this.initialGame.pieces.map((p) => ({ ...p })),
      currentFaction: this.initialGame.currentFaction,
      currentFactionIdx: this.initialGame.currentFactionIdx,
      state: "game_over",
      eliminatedFactions: new Set(this.initialGame.eliminatedFactions),
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
export function cloneGameForReplay(game) {
  // Create a fresh game and replay all moves
  // For now, return the game - in practice would create fresh Game instance
  return game;
}

/**
 * Clone game state for yield.
 */
export function cloneGameState(game) {
  return {
    pieces: game.pieces.map((p) => ({
      id: p.id,
      type: p.type,
      faction: p.faction,
      pos: { q: p.pos.q, r: p.pos.r },
      symbol: p.symbol,
      alive: p.alive,
      hasMoved: p.hasMoved,
    })),
    currentFaction: game.currentFaction,
    currentFactionIdx: game.currentFactionIdx,
    state: game.state,
    eliminatedFactions: Array.from(game.eliminatedFactions),
    capturedPieces: {
      fire: game.capturedPieces.fire.map((p) => p.id),
      water: game.capturedPieces.water.map((p) => p.id),
      nature: game.capturedPieces.nature.map((p) => p.id),
    },
    moveHistory: game.moveHistory,
  };
}

/**
 * Reconstruct a game from TSPN headers and moves.
 * Creates a fresh Game instance and replays all moves.
 */
export function reconstructGameFromTSPN(parsedTSPN, GameClass, boardCells) {
  const game = new GameClass();
  game.init(boardCells);

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
export function downloadGame(game, filename = null) {
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
export async function copyGameToClipboard(game) {
  const tspn = serializeGame(game);
  await navigator.clipboard.writeText(tspn);
}

/**
 * Load game from file.
 */
export function loadGameFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = parseTSPN(e.target.result);
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
export function loadGameFromString(tspnString) {
  return parseTSPN(tspnString);
}
