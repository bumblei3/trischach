import { Hex } from "./hex.ts";
import { FACTION, getRPSResult, FACTION_COLORS } from "./board.ts";
import { getValidMoves, createInitialPieces, PIECE_TYPE } from "./pieces.ts";
import {
  isKingdomCheck,
  legalMoveCheck,
  isCheckmateInternal,
  isStalemateInternal,
} from "./game-check.ts";
import type {
  Faction,
  PieceType,
  GameState,
  GameResult,
  Cell,
  Piece,
  Snapshot,
  AISnapshot,
  IGame,
} from "./types.ts";

// Re-export for backwards compatibility
export {
  isKingdomCheck as isKingInCheck,
  legalMoveCheck as wouldBeInCheck,
  isCheckmateInternal as isCheckmate,
  isStalemateInternal as isStalemate,
};

// Re-export types
export type { GameResult, Piece, GameState } from "./types.ts";

export const GAME_STATE = {
  SELECT_PIECE: "select_piece",
  SELECT_TARGET: "select_target",
  PROMOTION: "promotion",
  GAME_OVER: "game_over",
  DRAW_REPETITION: "draw_repetition",
  DRAW_50MOVE: "draw_50move",
} as const satisfies Record<string, GameState>;

const TURN_ORDER: readonly Faction[] = [
  FACTION.FIRE,
  FACTION.WATER,
  FACTION.NATURE,
];

// Promotion: piece types a pawn can promote to (excluding king and pawn)
export const PROMOTION_CHOICES: readonly PieceType[] = [
  PIECE_TYPE.QUEEN,
  PIECE_TYPE.ROOK,
  PIECE_TYPE.BISHOP,
  PIECE_TYPE.KNIGHT,
] as const;

export class Game {
  public pieces: Piece[] = [];
  public currentFactionIdx = 0;
  public state: GameState = GAME_STATE.SELECT_PIECE;
  public selectedPiece: Piece | null = null;
  public validMoves: Hex[] = [];
  public validAttacks: Hex[] = [];
  public eliminatedFactions = new Set<Faction>();
  public moveHistory: GameResult[] = [];

  // Callbacks
  public onUpdate: (() => void) | null = null;
  public onCombat: ((result: GameResult) => void) | null = null;
  public onGameOver: ((winner: Faction | null) => void) | null = null;
  public onElimination: ((faction: Faction) => void) | null = null;
  public onDraw: ((type: "repetition" | "50move") => void) | null = null;
  public onPromotion: ((piece: Piece) => void) | null = null;

  public boardCells: Map<string, Cell> | null = null;
  public rpsEnabled = true;
  public capturedPieces: Record<Faction, Piece[]> = {
    [FACTION.FIRE]: [] as Piece[],
    [FACTION.WATER]: [] as Piece[],
    [FACTION.NATURE]: [] as Piece[],
  } as Record<Faction, Piece[]>;
  public pendingPromotion: Piece | null = null;
  private _undoStack: Snapshot[] = [];
  public currentFaction: Faction = TURN_ORDER[0] as Faction;
  public _positionHistory = new Map<string, number>();
  public _halfmoveClock = 0;
  public _occupiedMap: Map<string, Piece> | null = null;

  constructor() {
    this.currentFaction = TURN_ORDER[0] as Faction;
  }

  get currentFactionName(): string {
    return FACTION_COLORS[this.currentFaction].name;
  }

  init(boardCells: Map<string, Cell>): void {
    this.boardCells = boardCells;
    this.pieces = createInitialPieces();
    this.currentFactionIdx = 0;
    this.currentFaction = TURN_ORDER[0] as Faction;
    this.state = GAME_STATE.SELECT_PIECE;
    this.eliminatedFactions.clear();
    this.moveHistory = [];
    this.pendingPromotion = null;
    this.capturedPieces = {
      [FACTION.FIRE]: [] as Piece[],
      [FACTION.WATER]: [] as Piece[],
      [FACTION.NATURE]: [] as Piece[],
    } as Record<Faction, Piece[]>;
    this._rebuildOccupiedMap();
    this._positionHistory = new Map();
    this._halfmoveClock = 0;
  }

  getAlivePieces(): Piece[] {
    return this.pieces.filter((p) => p.alive);
  }

  getPieceAt(hex: Hex): Piece | null {
    return this._occupiedMap?.get(hex.key) ?? null;
  }

  _rebuildOccupiedMap(): void {
    this._occupiedMap = new Map();
    for (const p of this.pieces) {
      if (p.alive) this._occupiedMap!.set(p.pos.key, p);
    }
  }

  isKingInCheck(faction: Faction): boolean {
    return isKingdomCheck(this as IGame, faction);
  }

  getLegalMoves(piece: Piece): { moves: Hex[]; attacks: Hex[] } {
    const { moves, attacks } = getValidMoves(
      piece,
      this.boardCells!,
      this._occupiedMap!,
    );
    const legalMoves: Hex[] = [];
    const legalAttacks: Hex[] = [];

    for (const target of moves) {
      if (legalMoveCheck(this as IGame, piece, target, piece.faction)) {
        legalMoves.push(target);
      }
    }
    for (const target of attacks) {
      if (legalMoveCheck(this as IGame, piece, target, piece.faction)) {
        legalAttacks.push(target);
      }
    }
    return { moves: legalMoves, attacks: legalAttacks };
  }

  isCheckmate(faction: Faction): boolean {
    return isCheckmateInternal(this as IGame, faction);
  }

  isStalemate(faction: Faction): boolean {
    return isStalemateInternal(this as IGame, faction);
  }

  /** Check if a pawn move to target triggers promotion. */
  isPromotion(piece: Piece, target: Hex): boolean {
    return piece.type === PIECE_TYPE.PAWN && target.r <= 0;
  }

  /** Complete a pending promotion by transforming the pawn into the chosen type. */
  completePromotion(newType: PieceType): GameResult | null {
    this._undoStack.push(this.snapshot());
    const piece = this.pendingPromotion;
    if (!piece) return null;

    const oldSymbol = piece.symbol;
    piece.type = newType;
    piece.symbol = {
      king: "♚",
      queen: "♛",
      rook: "♜",
      bishop: "♝",
      knight: "♞",
      pawn: "♟",
    }[newType];

    const result: GameResult = {
      action: "promotion",
      piece,
      from: oldSymbol,
      to: piece.symbol,
      type: newType,
      notation: `${piece.pos.q},${piece.pos.r} ♟→${piece.symbol}`,
    };

    this.pendingPromotion = null;
    this.moveHistory.push(result);
    this._rebuildOccupiedMap();

    // Check game over after promotion
    const alive = TURN_ORDER.filter((f) => !this.eliminatedFactions.has(f));
    if (alive.length <= 1) {
      this.state = GAME_STATE.GAME_OVER;
      result.gameOver = true;
      result.winner_faction = alive[0] ?? null;
      if (this.onGameOver) this.onGameOver(alive[0] ?? null);
      return result;
    }

    this._nextTurn();
    this.selectedPiece = null;
    this.state = GAME_STATE.SELECT_PIECE;
    if (this.onUpdate) this.onUpdate();
    return result;
  }

  handleCellClick(hex: Hex): GameResult | null {
    // Handle draw states - no moves allowed after draw
    if (
      this.state === GAME_STATE.DRAW_REPETITION ||
      this.state === GAME_STATE.DRAW_50MOVE
    ) {
      return null;
    }

    if (this.state === GAME_STATE.GAME_OVER) return null;
    if (this.state === GAME_STATE.PROMOTION) return null;

    if (this.state === GAME_STATE.SELECT_PIECE) {
      return this._selectPiece(hex);
    } else if (this.state === GAME_STATE.SELECT_TARGET) {
      return this._selectTarget(hex);
    }
    return null;
  }

  _selectPiece(hex: Hex): GameResult {
    const piece = this.getPieceAt(hex);
    if (!piece || piece.faction !== this.currentFaction) {
      // Maybe they clicked another of their pieces
      this.selectedPiece = null;
      this.state = GAME_STATE.SELECT_PIECE;
      return { action: "deselect" };
    }

    this.selectedPiece = piece;
    this._rebuildOccupiedMap();
    const { moves, attacks } = this.getLegalMoves(piece);
    this.validMoves = moves;
    this.validAttacks = attacks;
    this.state = GAME_STATE.SELECT_TARGET;

    // Categorize attacks by RPS result for UI color-coding
    const rpsAttacks = this.rpsEnabled
      ? categorizeAttacks(piece, attacks, this)
      : null;
    return { action: "select", piece, moves, attacks, rpsAttacks };
  }

  _selectTarget(hex: Hex): GameResult {
    this._undoStack.push(this.snapshot());
    // Check if clicking own piece (reselect)
    const clickedPiece = this.getPieceAt(hex);
    if (clickedPiece && clickedPiece.faction === this.currentFaction) {
      return this._selectPiece(hex);
    }

    const isMove = this.validMoves.some((m) => m.equals(hex));
    const isAttack = this.validAttacks.some((a) => a.equals(hex));

    if (!isMove && !isAttack) {
      // Cancel selection
      this.selectedPiece = null;
      this.state = GAME_STATE.SELECT_PIECE;
      return { action: "deselect" };
    }

    const result: GameResult = {
      action: "move",
      piece: this.selectedPiece!,
      from: this.selectedPiece!.pos,
      to: hex,
      notation: `${this.selectedPiece!.pos.q},${this.selectedPiece!.pos.r} ➔ ${hex.q},${hex.r}`,
    };

    if (isAttack) {
      const defender = this.getPieceAt(hex)!;
      const rps = this.rpsEnabled
        ? getRPSResult(this.selectedPiece!.faction, defender.faction)
        : "advantage";
      result.action = "combat";
      result.defender = defender;
      result.rpsResult = rps;

      if (rps === "advantage" || rps === "neutral") {
        // Attacker wins – normal capture
        defender.alive = false;
        this.selectedPiece!.pos = hex;
        this.selectedPiece!.hasMoved = true;
        this.capturedPieces[this.selectedPiece!.faction].push(defender);
        result.winner = this.selectedPiece!;
        result.loser = defender;
        result.notation = `${this.selectedPiece!.pos.q},${this.selectedPiece!.pos.r} ⚔️ ${defender.symbol} ${hex.q},${hex.r}`;
      } else {
        // Disadvantage – attacker dies!
        this.selectedPiece!.alive = false;
        this.capturedPieces[defender.faction].push(this.selectedPiece!);
        result.winner = defender;
        result.loser = this.selectedPiece!;
        result.notation = `${this.selectedPiece!.pos.q},${this.selectedPiece!.pos.r} ❌ ${defender.symbol} ${hex.q},${hex.r}`;
      }

      // Check for king elimination
      if (!result.loser!.alive && result.loser!.type === PIECE_TYPE.KING) {
        this.eliminatedFactions.add(result.loser!.faction);
        // Kill all pieces of eliminated faction
        for (const p of this.pieces) {
          if (p.faction === result.loser!.faction) p.alive = false;
        }
        result.elimination = result.loser!.faction;
        if (this.onElimination) this.onElimination(result.loser!.faction);
      }
    } else {
      // Normal move
      this.selectedPiece!.pos = hex;
      this.selectedPiece!.hasMoved = true;
    }

    this.moveHistory.push(result);
    this._rebuildOccupiedMap();

    // Check for pawn promotion
    if (this.isPromotion(this.selectedPiece!, hex)) {
      this.pendingPromotion = this.selectedPiece!;
      this.state = GAME_STATE.PROMOTION;
      result.promotion = true;
      result.notation = `${this.selectedPiece!.pos.q},${this.selectedPiece!.pos.r} ♟→?`;
      if (this.onPromotion) this.onPromotion(this.selectedPiece!);
      return result;
    }

    // Update draw state (threefold repetition + 50-move rule)
    const wasCapture =
      result.action === "combat" && result.rpsResult !== "disadvantage";
    const wasPawnMove = this.selectedPiece!.type === PIECE_TYPE.PAWN;
    const isDraw = this._updateDrawState(wasCapture, wasPawnMove);
    if (isDraw) {
      result.draw = true;
      return result;
    }

    // Check game over
    const alive = TURN_ORDER.filter((f) => !this.eliminatedFactions.has(f));
    if (alive.length <= 1) {
      this.state = GAME_STATE.GAME_OVER;
      result.gameOver = true;
      result.winner_faction = alive[0] ?? null;
      if (this.onGameOver) this.onGameOver(alive[0] ?? null);
      return result;
    }

    // Next turn
    this._nextTurn();
    this.selectedPiece = null;
    this.state = GAME_STATE.SELECT_PIECE;

    // Check for checkmate or stalemate of any faction that is in check
    let checkedFaction: Faction | null = null;
    for (const fac of TURN_ORDER) {
      if (this.eliminatedFactions.has(fac)) continue;
      if (this.isKingInCheck(fac)) {
        checkedFaction = fac;
        break;
      }
    }
    if (checkedFaction !== null) {
      const isCM = this.isCheckmate(checkedFaction);
      const isStale = this.isStalemate(checkedFaction);
      if (isCM || isStale) {
        if (isCM) {
          result.checkmate = checkedFaction;
        } else {
          result.stalemate = checkedFaction;
        }
        this.eliminatedFactions.add(checkedFaction);
        for (const p of this.pieces) {
          if (p.faction === checkedFaction) p.alive = false;
        }
        this._rebuildOccupiedMap();
        result.elimination = checkedFaction;
        if (this.onElimination) this.onElimination(checkedFaction);

        // Check game over after elimination
        const aliveAfter = TURN_ORDER.filter(
          (f) => !this.eliminatedFactions.has(f),
        );
        if (aliveAfter.length <= 1) {
          this.state = GAME_STATE.GAME_OVER;
          result.gameOver = true;
          result.winner_faction = aliveAfter[0] ?? null;
          result.inCheck = this.isKingInCheck(this.currentFaction);
          if (this.onGameOver) this.onGameOver(aliveAfter[0] ?? null);
          return result;
        }
        // Continue to next faction after elimination
        this._nextTurn();
      }
    }

    result.inCheck = this.isKingInCheck(this.currentFaction);

    if (this.onUpdate) this.onUpdate();
    return result;
  }

  _nextTurn(): void {
    const startIdx = this.currentFactionIdx;
    let nextFaction = TURN_ORDER[(this.currentFactionIdx + 1) % 3] as Faction;
    do {
      this.currentFactionIdx = (this.currentFactionIdx + 1) % 3;
      // Safety: prevent infinite loop if all factions eliminated
      if (this.currentFactionIdx === startIdx) break;
      nextFaction = TURN_ORDER[this.currentFactionIdx] as Faction;
    } while (this.eliminatedFactions.has(nextFaction));
    this.currentFaction = nextFaction;
  }

  /**
   * Simulate a move without side effects (for AI lookahead).
   * Returns an undo object that can be passed to undoMove().
   * Does NOT call callbacks, does NOT push to moveHistory.
   */
  simulateMove(piece: Piece, target: Hex): AISnapshot {
    const undo: AISnapshot = {
      piece,
      from: new Hex(piece.pos.q, piece.pos.r),
      pieceHasMoved: piece.hasMoved,
      wasAttack: false,
      defender: undefined,
      defenderWasKilled: false,
      attackerDied: false,
      eliminatedFaction: undefined,
      prevFactionIdx: this.currentFactionIdx,
    };

    const defender = this.getPieceAt(target);

    if (defender) {
      undo.wasAttack = true;
      undo.defender = defender;

      const rps = this.rpsEnabled
        ? getRPSResult(piece.faction, defender.faction)
        : "advantage";

      if (rps === "advantage" || rps === "neutral") {
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

    // Check for pawn promotion (for AI evaluation)
    // Only if the pawn is still alive (didn't die from disadvantage)
    if (piece.alive && piece.type === PIECE_TYPE.PAWN && target.r <= 0) {
      undo.promotion = piece.type;
    }

    this._rebuildOccupiedMap();
    this._nextTurn();
    return undo;
  }

  /**
   * Undo a simulated move using the undo object from simulateMove().
   */
  undoMove(undo: AISnapshot): void {
    // Restore turn
    this.currentFactionIdx = undo.prevFactionIdx;
    this.currentFaction = TURN_ORDER[this.currentFactionIdx] as Faction;

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

  /**
   * Create a snapshot of the game state for undo functionality.
   * @returns Full game snapshot for undo/restore
   */
  snapshot(): Snapshot {
    return {
      pieces: this.pieces.map((p) => ({
        id: p.id,
        faction: p.faction,
        type: p.type,
        pos: { q: p.pos.q, r: p.pos.r },
        alive: p.alive,
        hasMoved: p.hasMoved,
      })),
      currentFactionIdx: this.currentFactionIdx,
      eliminatedFactions: new Set(this.eliminatedFactions),
      capturedPieces: {
        fire: this.capturedPieces[FACTION.FIRE].map((p) => p.id),
        water: this.capturedPieces[FACTION.WATER].map((p) => p.id),
        nature: this.capturedPieces[FACTION.NATURE].map((p) => p.id),
      },
      moveHistoryLength: this.moveHistory.length,
    };
  }

  /**
   * Restore game state from a snapshot.
   * @param snap - The snapshot object
   */
  restore(snap: Snapshot): void {
    // Restore pieces
    this.pieces.forEach((p) => {
      const sp = snap.pieces.find((sp) => sp.id === p.id);
      if (sp) {
        p.faction = sp.faction;
        p.type = sp.type;
        p.pos = new Hex(sp.pos.q, sp.pos.r);
        p.alive = sp.alive;
        p.hasMoved = sp.hasMoved;
      }
    });
    this.currentFactionIdx = snap.currentFactionIdx;
    this.currentFaction = TURN_ORDER[this.currentFactionIdx] as Faction;
    this.eliminatedFactions = new Set(snap.eliminatedFactions);
    // restore capturedPieces
    for (const fac of [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]) {
      this.capturedPieces[fac] = [];
    }
    for (const fac of [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]) {
      const ids =
        snap.capturedPieces[fac.toLowerCase() as "fire" | "water" | "nature"];
      for (const id of ids) {
        const piece = this.pieces.find((p) => p.id === id);
        if (piece) this.capturedPieces[fac].push(piece);
      }
    }
    // truncate moveHistory
    this.moveHistory.length = snap.moveHistoryLength;
    this._rebuildOccupiedMap();
    // clear selection
    this.selectedPiece = null;
    this.state = GAME_STATE.SELECT_PIECE;
    this.pendingPromotion = null;
    this.onPromotion = null;
  }

  /**
   * Undo the last move, returning the snapshot restored.
   * @returns The snapshot that was restored, or null if nothing to undo
   */
  undo(): Snapshot | null {
    if (this._undoStack.length === 0) return null;
    const snap = this._undoStack.pop()!;
    this.restore(snap);
    if (this.onUpdate) this.onUpdate();
    return snap;
  }

  /** Clear the undo stack (e.g., for new game or puzzle mode) */
  clearUndoStack(): void {
    this._undoStack = [];
  }

  /**
   * Generate a position hash for repetition detection.
   * Includes current player to match standard chess threefold repetition rule.
   */
  _positionHash(): string {
    const pieces = this.getAlivePieces()
      .filter((p) => p.alive)
      .map((p) => `${p.faction[0]}${p.type[0]}${p.pos.q},${p.pos.r}`)
      .sort()
      .join("|");
    // Include current faction index for proper threefold repetition (same position + same player to move)
    return `${pieces}#${this.currentFactionIdx}`;
  }

  /**
   * Update position history and halfmove clock after a move.
   * Returns true if a draw is detected.
   */
  _updateDrawState(wasCapture: boolean, wasPawnMove: boolean): boolean {
    const hash = this._positionHash();

    // Threefold repetition: increment count for current position
    const count = (this._positionHistory.get(hash) || 0) + 1;
    this._positionHistory.set(hash, count);

    // 50-move rule: increment on any half-move, reset on capture or pawn move
    if (wasCapture || wasPawnMove) {
      this._halfmoveClock = 0;
    } else {
      this._halfmoveClock++;
    }

    // Check for draws
    if (count >= 3) {
      this.state = GAME_STATE.DRAW_REPETITION;
      if (this.onDraw) this.onDraw("repetition");
      return true;
    }
    if (this._halfmoveClock >= 100) {
      // 50 full moves = 100 half-moves
      this.state = GAME_STATE.DRAW_50MOVE;
      if (this.onDraw) this.onDraw("50move");
      return true;
    }
    return false;
  }
}

// ─── RPS Attack Categorization ─────────────────────────────────────────

/**
 * Categorize attack targets by RPS result for UI color-coding.
 * Returns { advantage: Hex[], disadvantage: Hex[], neutral: Hex[] }
 */
function categorizeAttacks(
  piece: Piece,
  attacks: Hex[],
  game: Game,
): { advantage: Hex[]; disadvantage: Hex[]; neutral: Hex[] } {
  const result = {
    advantage: [] as Hex[],
    disadvantage: [] as Hex[],
    neutral: [] as Hex[],
  };
  for (const target of attacks) {
    const defender = game.getPieceAt(target);
    if (!defender) continue;
    const rps = getRPSResult(piece.faction, defender.faction);
    if (rps === "advantage") result.advantage.push(target);
    else if (rps === "disadvantage") result.disadvantage.push(target);
    else result.neutral.push(target);
  }
  return result;
}
