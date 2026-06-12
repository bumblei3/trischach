/**
 * TriSchach Game Replay/Export System
 * 
 * PGN-like format for 3-player hexagonal chess with RPS mechanics.
 * 
 * Format: TSPN (TriSchach Portable Notation)
 * - Header tags: [Event "..."] [Site "..."] [Date "..."] [Round "..."] 
 *   [White "Fire"] [Black "Water"] [Green "Nature"] [Result "..."] [RPS "on|off"]
 * - Moves: 1. fire_pawn_10 e4 2. water_pawn_25 e5 3. nature_pawn_40 e6 ...
 *   Format: <moveNumber>. <faction>_<pieceId> <targetCoord> [<rpsResult>] [<special>]
 *   Special: =Q (promotion), x (capture), # (checkmate), + (check), !? (annotations)
 */

export const REPLAY_VERSION = '1.0';

// ─── Serialization ────────────────────────────────────────────────────────

/**
 * Serialize a game to TSPN format string.
 */
export function serializeGame(game, options = {}) {
  const {
    event = 'Casual Game',
    site = 'TriSchach',
    round = '1',
    result = getResultString(game),
    rpsEnabled = game.rpsEnabled,
    includeComments = true,
  } = options;

  const lines = [];
  const date = new Date().toISOString().split('T')[0];

  // Headers
  lines.push(`[Event "${escapePGN(event)}"]`);
  lines.push(`[Site "${escapePGN(site)}"]`);
  lines.push(`[Date "${date}"]`);
  lines.push(`[Round "${escapePGN(round)}"]`);
  lines.push(`[Fire "Player 1"]`);
  lines.push(`[Water "Player 2"]`);
  lines.push(`[Nature "Player 3"]`);
  lines.push(`[Result "${result}"]`);
  lines.push(`[RPS "${rpsEnabled ? 'on' : 'off'}"]`);
  lines.push(`[Variant "TriSchach"]`);
  lines.push(`[Version "${REPLAY_VERSION}"]`);
  lines.push('');

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
      moveLines.push(moveBuffer.join(' '));
      moveBuffer = [];
      moveNumber++;
    } else {
      // Third faction in round - start new line
      moveLines.push(moveBuffer.join(' ') + ` ${notation}`);
      moveBuffer = [];
      moveNumber++;
    }
  }

  // Flush remaining
  if (moveBuffer.length > 0) {
    moveLines.push(moveBuffer.join(' '));
  }

  // Wrap lines at ~80 chars
  for (const line of moveLines) {
    lines.push(...wrapLine(line, 80));
  }

  return lines.join('\n');
}

/**
 * Format a single move for TSPN output.
 */
function formatMove(move, game, moveIndex) {
  // Use 'to' for target position (move history uses 'to', not 'target')
  const target = move.to;
  
  // Handle promotion-only entries (no target)
  if (move.action === 'promotion' || !target) {
    return `${move.piece?.faction || 'unknown'}_Promotion=Q`;
  }
  
  const piece = move.piece;
  const faction = piece.faction;
  const pieceName = piece.type.charAt(0).toUpperCase() + piece.type.slice(1);
  
  // Coordinate notation: q,r
  const coord = `${target.q},${target.r}`;
  
  let notation = `${faction}_${pieceName}_${coord}`;
  
  // Add RPS result for captures
  if (move.action === 'combat' && move.rpsResult) {
    const rpsSymbol = move.rpsResult === 'advantage' ? '>' : 
                      move.rpsResult === 'disadvantage' ? '<' : '=';
    notation += ` ${rpsSymbol}`;
  }
  
  // Add capture indicator
  if (move.action === 'combat') {
    notation = notation.replace('_', 'x');
  }
  
  // Add promotion
  if (move.promotion) {
    notation += '=Q';
  }
  
  // Add check/checkmate
  if (move.checkmate) {
    notation += '#';
  } else if (move.inCheck) {
    notation += '+';
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
function getResultString(game) {
  if (game.state !== 'game_over') return '*';
  
  const winner = game.moveHistory[game.moveHistory.length - 1]?.winner_faction;
  if (!winner) return '1/2-1/2-1/2'; // Draw (shouldn't happen in 3-player)
  
  // Map faction to result
  const results = {
    fire: '1-0-0',
    water: '0-1-0',
    nature: '0-0-1',
  };
  return results[winner] || '*';
}

/**
 * Escape string for PGN header.
 */
function escapePGN(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

/**
 * Wrap long line at maxLength.
 */
function wrapLine(line, maxLength) {
  if (line.length <= maxLength) return [line];
  
  const words = line.split(' ');
  const lines = [];
  let current = '';
  
  for (const word of words) {
    if ((current + word).length > maxLength) {
      lines.push(current.trim());
      current = word + ' ';
    } else {
      current += word + ' ';
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
  const lines = tspnString.trim().split('\n');
  const headers = {};
  const moves = [];
  let inMoves = false;
  let moveText = '';
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (!inMoves) {
      // Parse headers
      const match = trimmed.match(/^\[(\w+)\s+"([^"]*)"\]$/);
      if (match) {
        headers[match[1]] = match[2];
      } else if (trimmed === '') {
        inMoves = true;
      }
    } else {
      moveText += ' ' + trimmed;
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
 */
function parseMoveText(text) {
  // Remove move numbers (1., 2., etc.)
  const cleaned = text.replace(/\d+\.\s*/g, '');
  const tokens = cleaned.split(/\s+/).filter(t => t);
  
  const moves = [];
  for (const token of tokens) {
    if (token.startsWith('[') && token.endsWith(']')) {
      // Comment/elimination annotation
      continue;
    }
    moves.push(parseMoveToken(token));
  }
  
  return moves;
}

/**
 * Parse a single move token.
 * Format: faction_PieceName_q,r [><=] [=Q] [#+] [comments]
 */
function parseMoveToken(token) {
  // Simple parser - in practice, moves are replayed by re-executing
  return { san: token }; // Standard Algebraic Notation (our variant)
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
        game.completePromotion(move.promotionType || 'queen');
      }
    }
    
    yield { 
      game: cloneGameState(game), 
      move, 
      index: i,
      result: move.result || move 
    };
  }
}

/**
 * Clone game for replay (immutable snapshot).
 */
function cloneGameForReplay(game) {
  // This would need Game constructor - simplified for now
  return game; // In practice, create fresh Game and replay moves
}

/**
 * Clone game state for yield.
 */
function cloneGameState(game) {
  return {
    pieces: game.pieces.map(p => ({
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
      fire: game.capturedPieces.fire.map(p => p.id),
      water: game.capturedPieces.water.map(p => p.id),
      nature: game.capturedPieces.nature.map(p => p.id),
    },
    moveHistory: game.moveHistory,
  };
}

// ─── Export/Import Helpers ────────────────────────────────────────────────

/**
 * Download game as .tspn file.
 */
export function downloadGame(game, filename = null) {
  const tspn = serializeGame(game);
  const blob = new Blob([tspn], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `trischach-${new Date().toISOString().slice(0,10)}.tspn`;
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