import { FACTION, getRPSResult, FACTION_COLORS } from './board.js';
import { getValidMoves, createInitialPieces, PIECE_TYPE } from './pieces.js';

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
  }

  getAlivePieces() {
    return this.pieces.filter(p => p.alive);
  }

  getPieceAt(hex) {
    return this.getAlivePieces().find(p => p.pos.equals(hex));
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
    const { moves, attacks } = getValidMoves(piece, this.boardCells, this.getAlivePieces());
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

      if (rps === 'advantage') {
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
}
