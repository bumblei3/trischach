import { FACTION, getRPSResult, FACTION_COLORS } from './board.js';
import { getValidMoves, createInitialPieces, PIECE_TYPE } from './pieces.js';
import { Hex } from './hex.js';

export const GAME_STATE = {
  SELECT_PIECE: 'select_piece',
  SELECT_TARGET: 'select_target',
  GAME_OVER: 'game_over',
};

const TURN_ORDER = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE];

export class Game {
  constructor() {
    this.pieces = [];
    this.currentFactionIdx = 0;
    this.state = GAME_STATE.SELECT_PIECE;
    this.selectedPiece = null;
    this.validMoves = [];
    this.validAttacks = [];
    this.eliminatedFactions = new Set();
    this.moveHistory = [];
    this.onUpdate = null;
    this.onCombat = null;
    this.onGameOver = null;
    this.onElimination = null;
    this.boardCells = null;
    this.rpsEnabled = true;
    this.capturedPieces = { [FACTION.FIRE]: [], [FACTION.WATER]: [], [FACTION.NATURE]: [] };
  }

  get currentFaction() {
    return TURN_ORDER[this.currentFactionIdx];
  }

  get currentFactionName() {
    return FACTION_COLORS[this.currentFaction].name;
  }

  init(boardCells) {
    this.boardCells = boardCells;
    this.pieces = createInitialPieces();
    this.currentFactionIdx = 0;
    this.state = GAME_STATE.SELECT_PIECE;
    this.eliminatedFactions.clear();
    this.moveHistory = [];
    this.selectedPiece = null;
    this.capturedPieces = { [FACTION.FIRE]: [], [FACTION.WATER]: [], [FACTION.NATURE]: [] };
    this._rebuildOccupiedMap();
  }

  getAlivePieces() {
    return this.pieces.filter(p => p.alive);
  }

  getPieceAt(hex) {
    return this._occupiedMap?.get(hex.key) || null;
  }

  _rebuildOccupiedMap() {
    this._occupiedMap = new Map();
    for (const p of this.pieces) {
      if (p.alive) this._occupiedMap.set(p.pos.key, p);
    }
  }

  handleCellClick(hex) {
    if (this.state === GAME_STATE.GAME_OVER) return null;

    if (this.state === GAME_STATE.SELECT_PIECE) {
      return this._selectPiece(hex);
    } else if (this.state === GAME_STATE.SELECT_TARGET) {
      return this._selectTarget(hex);
    }
    return null;
  }

  _selectPiece(hex) {
    const piece = this.getPieceAt(hex);
    if (!piece || piece.faction !== this.currentFaction) {
      // Maybe they clicked another of their pieces
      this.selectedPiece = null;
      this.state = GAME_STATE.SELECT_PIECE;
      return { action: 'deselect' };
    }

    this.selectedPiece = piece;
    this._rebuildOccupiedMap();
    const { moves, attacks } = getValidMoves(piece, this.boardCells, this._occupiedMap);
    this.validMoves = moves;
    this.validAttacks = attacks;
    this.state = GAME_STATE.SELECT_TARGET;
    return { action: 'select', piece, moves, attacks };
  }

  _selectTarget(hex) {
    // Check if clicking own piece (reselect)
    const clickedPiece = this.getPieceAt(hex);
    if (clickedPiece && clickedPiece.faction === this.currentFaction) {
      return this._selectPiece(hex);
    }

    const isMove = this.validMoves.some(m => m.equals(hex));
    const isAttack = this.validAttacks.some(a => a.equals(hex));

    if (!isMove && !isAttack) {
      // Cancel selection
      this.selectedPiece = null;
      this.state = GAME_STATE.SELECT_PIECE;
      return { action: 'deselect' };
    }

    const result = { 
      action: 'move', 
      piece: this.selectedPiece, 
      from: this.selectedPiece.pos, 
      to: hex,
      notation: `${this.selectedPiece.pos.q},${this.selectedPiece.pos.r} ➔ ${hex.q},${hex.r}`
    };

    if (isAttack) {
      const defender = this.getPieceAt(hex);
      const rps = this.rpsEnabled ? getRPSResult(this.selectedPiece.faction, defender.faction) : 'advantage';
      result.action = 'combat';
      result.defender = defender;
      result.rpsResult = rps;

      if (rps === 'advantage' || rps === 'neutral') {
        // Attacker wins – normal capture
        defender.alive = false;
        this.selectedPiece.pos = hex;
        this.selectedPiece.hasMoved = true;
        this.capturedPieces[this.selectedPiece.faction].push(defender);
        result.winner = this.selectedPiece;
        result.loser = defender;
        result.notation = `${this.selectedPiece.pos.q},${this.selectedPiece.pos.r} ⚔️ ${defender.symbol} ${hex.q},${hex.r}`;
      } else {
        // Disadvantage – attacker dies!
        this.selectedPiece.alive = false;
        this.capturedPieces[defender.faction].push(this.selectedPiece);
        result.winner = defender;
        result.loser = this.selectedPiece;
        result.notation = `${this.selectedPiece.pos.q},${this.selectedPiece.pos.r} ❌ ${defender.symbol} ${hex.q},${hex.r}`;
      }

      // Check for king elimination
      if (!result.loser.alive && result.loser.type === PIECE_TYPE.KING) {
        this.eliminatedFactions.add(result.loser.faction);
        // Kill all pieces of eliminated faction
        for (const p of this.pieces) {
          if (p.faction === result.loser.faction) p.alive = false;
        }
        result.elimination = result.loser.faction;
        if (this.onElimination) this.onElimination(result.loser.faction);
      }
    } else {
      // Normal move
      this.selectedPiece.pos = hex;
      this.selectedPiece.hasMoved = true;
    }

    this.moveHistory.push(result);
    this._rebuildOccupiedMap();

    // Check game over
    const alive = TURN_ORDER.filter(f => !this.eliminatedFactions.has(f));
    if (alive.length <= 1) {
      this.state = GAME_STATE.GAME_OVER;
      result.gameOver = true;
      result.winner_faction = alive[0] || null;
      if (this.onGameOver) this.onGameOver(alive[0]);
      return result;
    }

    // Next turn
    this._nextTurn();
    this.selectedPiece = null;
    this.state = GAME_STATE.SELECT_PIECE;
    if (this.onUpdate) this.onUpdate();
    return result;
  }

  _nextTurn() {
    do {
      this.currentFactionIdx = (this.currentFactionIdx + 1) % 3;
    } while (this.eliminatedFactions.has(this.currentFaction));
  }

  /**
   * Simulate a move without side effects (for AI lookahead).
   * Returns an undo object that can be passed to undoMove().
   * Does NOT call callbacks, does NOT push to moveHistory.
   */
  simulateMove(piece, target) {
    const undo = {
      piece,
      from: new Hex(piece.pos.q, piece.pos.r),
      pieceHasMoved: piece.hasMoved,
      wasAttack: false,
      defender: null,
      defenderWasKilled: false,
      attackerDied: false,
      eliminatedFaction: null,
      prevFactionIdx: this.currentFactionIdx,
    };

    const defender = this.getPieceAt(target);

    if (defender) {
      undo.wasAttack = true;
      undo.defender = defender;

      const rps = this.rpsEnabled ? getRPSResult(piece.faction, defender.faction) : 'advantage';

      if (rps === 'advantage' || rps === 'neutral') {
        // Attacker wins
        defender.alive = false;
        undo.defenderWasKilled = true;
        piece.pos = target;
        piece.hasMoved = true;
        this.capturedPieces[piece.faction].push(defender);

        // King elimination
        if (defender.type === PIECE_TYPE.KING) {
          undo.eliminatedFaction = defender.faction;
          this.eliminatedFactions.add(defender.faction);
          for (const p of this.pieces) {
            if (p.faction === defender.faction) p.alive = false;
          }
        }
      } else {
        // Attacker dies (disadvantage)
        piece.alive = false;
        undo.attackerDied = true;
        this.capturedPieces[defender.faction].push(piece);

        if (piece.type === PIECE_TYPE.KING) {
          undo.eliminatedFaction = piece.faction;
          this.eliminatedFactions.add(piece.faction);
          for (const p of this.pieces) {
            if (p.faction === piece.faction) p.alive = false;
          }
        }
      }
    } else {
      // Normal move
      piece.pos = target;
      piece.hasMoved = true;
    }

    this._rebuildOccupiedMap();
    this._nextTurn();
    return undo;
  }

  /**
   * Undo a simulated move using the undo object from simulateMove().
   */
  undoMove(undo) {
    // Restore turn
    this.currentFactionIdx = undo.prevFactionIdx;

    // Undo elimination
    if (undo.eliminatedFaction) {
      this.eliminatedFactions.delete(undo.eliminatedFaction);
      for (const p of this.pieces) {
        if (p.faction === undo.eliminatedFaction) p.alive = true;
      }
    }

    if (undo.wasAttack) {
      // Restore defender if it was killed
      if (undo.defenderWasKilled && undo.defender) {
        undo.defender.alive = true;
        const capList = this.capturedPieces[undo.piece.faction];
        const idx = capList.indexOf(undo.defender);
        if (idx !== -1) capList.splice(idx, 1);
      }

      // Restore attacker if it died (disadvantage)
      if (undo.attackerDied) {
        undo.piece.alive = true;
        // Attacker was pushed to defender's captured list
        // We need to find which faction captured it
        for (const fac of [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]) {
          const capList = this.capturedPieces[fac];
          const idx = capList.indexOf(undo.piece);
          if (idx !== -1) {
            capList.splice(idx, 1);
            break;
          }
        }
      }
    }

    // Restore piece position and state
    undo.piece.pos = undo.from;
    undo.piece.hasMoved = undo.pieceHasMoved;

    this._rebuildOccupiedMap();
  }
}
