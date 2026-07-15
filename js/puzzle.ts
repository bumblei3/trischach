/**
 * TriSchach Puzzle Mode
 * Generates and manages "Mate in N" puzzles from Opening Book positions.
 */

import { Game, GAME_STATE, GameState } from "./game.ts";
import { Hex } from "./hex.ts";
import type { IGame, Piece, Faction, PieceType, Cell } from "./types.ts";
import { calculateBestMove, setAIDepth, setAIPersonality } from "./ai.ts";
import { boardHash, getBookMoves, OPENING_BOOK } from "./opening-book.ts";
import { isCheckmateInternal, isKingdomCheck } from "./game-check.ts";

// ─── Types ────────────────────────────────────────────────────────────────

export interface Puzzle {
  id: string;
  fen: string; // Simplified position representation
  initialMoves: PuzzleMove[]; // Moves to reach puzzle position
  solution: PuzzleMove[]; // Best line to mate
  mateIn: number; // Theoretical mate distance
  difficulty: "easy" | "medium" | "hard";
  faction: Faction; // Side to move and deliver mate
  createdAt: number;
  stats?: {
    attempts: number;
    solved: number;
    avgTime: number;
  };
}

export interface PuzzleMove {
  pieceId: string;
  pieceType: PieceType;
  faction: Faction;
  from: { q: number; r: number };
  to: { q: number; r: number };
  isCapture: boolean;
  isCheck: boolean;
  isMate: boolean;
  san: string; // Standard Algebraic Notation
}

export interface PuzzleState {
  currentPuzzle: Puzzle | null;
  currentMoveIndex: number;
  userMoves: PuzzleMove[];
  startTime: number;
  isComplete: boolean;
  isFailed: boolean;
  hintUsed: boolean;
  expectedMove?: PuzzleMove;
}

// handleCellClick mutates game.state at runtime, but TS narrows it via
// control-flow analysis and wrongly concludes state can never be "game_over"
// after the click calls. Compare against the raw string to avoid that pitfall.
function isGameOverState(state: GameState): boolean {
  return (state as string) === GAME_STATE.GAME_OVER;
}

// ─── Constants ────────────────────────────────────────────────────────────

const PUZZLE_STORAGE_KEY = "trischach-puzzles";
const PUZZLE_PROGRESS_KEY = "trischach-puzzle-progress";
const MAX_PUZZLES_PER_BATCH = 50;
const MATE_SEARCH_DEPTH = 6; // Search depth for mate finding

// ─── Puzzle Generator ────────────────────────────────────────────────────

/**
 * Generate puzzles from Opening Book positions by searching for forced mates.
 */
export async function generatePuzzlesFromBook(
  count: number = 20,
): Promise<Puzzle[]> {
  const puzzles: Puzzle[] = [];
  const bookPositions = Array.from(OPENING_BOOK.entries());
  const bookStats = getBookStats();

  console.log(
    `Puzzle Generator: ${bookStats.positions} book positions available`,
  );

  // Shuffle positions for variety
  shuffleArray(bookPositions);

  for (const [hash, variations] of bookPositions) {
    if (puzzles.length >= count) break;

    // Reconstruct position from hash
    const game = reconstructGameFromHash(hash);
    if (!game) continue;

    // Only generate puzzles for positions where side to move is not in check already
    if (isKingdomCheck(game, game.currentFaction)) continue;

    // Try to find a forced mate from this position
    const puzzle = await findMatePuzzle(game);
    if (puzzle && (await validatePuzzle(puzzle))) {
      puzzles.push(puzzle);
    }
  }

  console.log(`Puzzle Generator: Created ${puzzles.length} puzzles`);
  return puzzles;
}

/**
 * Reconstruct a Game instance from a book hash.
 */
function reconstructGameFromHash(hash: string): Game | null {
  try {
    const [piecesStr, factionIdxStr] = hash.split("#");
    const factionIdx = parseInt(factionIdxStr ?? "0", 10);

    const game = new Game();
    const cells = generateBoardForPuzzle();
    game.init(cells);

    // Clear board
    for (const p of game.pieces) p.alive = false;

    // Parse pieces string (format: Fp-4,5|Wk0,0|...)
    if (piecesStr) {
      const pieceEntries = piecesStr.split("|");
      for (const entry of pieceEntries) {
        if (!entry) continue;
        const factionChar = entry[0];
        const typeChar = entry[1];
        const coords = entry.slice(2).split(",");
        const q = Number(coords[0]);
        const r = Number(coords[1]);

        const faction: Faction =
          factionChar === "F"
            ? "fire"
            : factionChar === "W"
              ? "water"
              : "nature";
        const piece = game.pieces.find(
          (p) => p.faction === faction && p.pos.q === q && p.pos.r === r,
        );
        if (piece) {
          piece.alive = true;
        }
      }
    }

    game.currentFactionIdx = factionIdx % 3;
    const factions = ["fire", "water", "nature"] as const;
    game.currentFaction = factions[game.currentFactionIdx] ?? "fire";
    game._rebuildOccupiedMap();

    return game;
  } catch {
    return null;
  }
}

/**
 * Generate a simple board for puzzle reconstruction (no SVG needed).
 */
function generateBoardForPuzzle(): Map<string, Cell> {
  // Import here to avoid circular deps
  const { generateBoard } = require("./board.ts");
  return generateBoard();
}

/**
 * Search for a forced mate from the given position using the AI engine.
 */
async function findMatePuzzle(game: Game): Promise<Puzzle | null> {
  const originalDepth = 4; // We'll use iterative deepening
  const faction = game.currentFaction;

  // First, check if there's an immediate mate
  const immediateMate = findImmediateMate(game);
  if (immediateMate) {
    return buildPuzzle(game, [immediateMate], 1, faction);
  }

  // Use AI to search for forced mate sequences
  // We'll simulate the AI search with increasing depth
  for (let depth = 2; depth <= MATE_SEARCH_DEPTH; depth++) {
    setAIDepth(depth);
    setAIPersonality("tactical"); // Tactical personality finds mates better

    const moves = await searchForcedMate(game, depth, faction);
    if (moves && moves.length > 0) {
      const mateIn = Math.ceil(moves.length / 3); // 3 factions per full ply
      return buildPuzzle(game, moves, mateIn, faction);
    }
  }

  return null;
}

/**
 * Find all legal moves that immediately mate (eliminate) from the side to move.
 * Used for mate-in-1 generation and uniqueness checks.
 * Always uses the select → target click sequence (Game state machine).
 */
export function findAllImmediateMatingMoves(game: Game): PuzzleMove[] {
  const mates: PuzzleMove[] = [];
  const pieces = game
    .getAlivePieces()
    .filter((p) => p.faction === game.currentFaction);

  for (const piece of pieces) {
    const { moves, attacks } = game.getLegalMoves(piece);
    for (const target of [...moves, ...attacks]) {
      const isCapture = !!game.getPieceAt(target);
      const testGame = cloneGameForTest(game);
      const testPiece = testGame.getPieceAt(piece.pos);
      if (!testPiece) continue;

      const selectResult = testGame.handleCellClick(testPiece.pos);
      if (!selectResult || selectResult.action !== "select") continue;

      const moveResult = testGame.handleCellClick(target);
      if (
        !moveResult ||
        (moveResult.action !== "move" && moveResult.action !== "combat")
      ) {
        continue;
      }

      // After a successful move, currentFaction is the next side to move.
      // Mate means that side is checkmated or the game already ended.
      const isMate =
        isGameOverState(testGame.state) ||
        isCheckmateInternal(testGame, testGame.currentFaction);

      if (isMate) {
        mates.push({
          pieceId: piece.id,
          pieceType: piece.type,
          faction: piece.faction,
          from: { q: piece.pos.q, r: piece.pos.r },
          to: { q: target.q, r: target.r },
          isCapture,
          isCheck: true,
          isMate: true,
          san: formatSAN(piece, target, isCapture, true, true),
        });
      }
    }
  }
  return mates;
}

/**
 * Find immediate mate in 1 move.
 */
function findImmediateMate(game: Game): PuzzleMove | null {
  const mates = findAllImmediateMatingMoves(game);
  return mates[0] ?? null;
}

/**
 * True if the puzzle's first move is unique among immediate mating moves.
 * Mate-in-1 requires exactly one mating move matching the solution.
 * Longer mates require no faster (immediate) alternative mate.
 */
export function hasUniqueSolution(puzzle: Puzzle): boolean {
  const game = deserializePosition(puzzle.fen);
  if (!game) return false;

  const first = puzzle.solution[0];
  if (!first) return false;

  const mates = findAllImmediateMatingMoves(game);
  const matchesFirst = (m: PuzzleMove) =>
    m.pieceId === first.pieceId &&
    m.to.q === first.to.q &&
    m.to.r === first.to.r &&
    m.from.q === first.from.q &&
    m.from.r === first.from.r;

  if (puzzle.mateIn <= 1 || puzzle.solution.length === 1) {
    return mates.length === 1 && matchesFirst(mates[0]!);
  }

  // Multi-move: no alternative immediate mate (or only the solution first move).
  if (mates.length === 0) return true;
  return mates.length === 1 && matchesFirst(mates[0]!);
}

/**
 * Search for forced mate using the AI engine.
 */
async function searchForcedMate(
  game: Game,
  maxDepth: number,
  matingFaction: Faction,
): Promise<PuzzleMove[] | null> {
  // This is a simplified version - in production we'd use the actual AI search
  // with mate scoring. For now, we'll simulate by checking if AI finds a line
  // that leads to mate within the depth.

  const testGame = cloneGameForTest(game);
  const solutionMoves: PuzzleMove[] = [];

  for (let ply = 0; ply < maxDepth * 3; ply++) {
    // 3 factions per ply
    if (testGame.state === GAME_STATE.GAME_OVER) break;

    const currentFaction = testGame.currentFaction;

    // If it's the mating faction's turn, use AI to find best move
    if (currentFaction === matingFaction) {
      const move = calculateBestMove(testGame, currentFaction);
      if (!move) return null;

      const piece = move.piece;
      const target = move.target;
      const isCapture = move.type === "attack";

      const result = testGame.handleCellClick(piece.pos);
      if (!result) return null;

      const moveResult = testGame.handleCellClick(target);

      const checkResult = isKingdomCheck(
        testGame,
        getNextFaction(testGame, currentFaction)!,
      );
      const isGameOver = isGameOverState(testGame.state);
      const isMate = isGameOver;

      solutionMoves.push({
        pieceId: piece.id,
        pieceType: piece.type,
        faction: piece.faction,
        from: { q: piece.pos.q, r: piece.pos.r },
        to: { q: target.q, r: target.r },
        isCapture,
        isCheck: isKingdomCheck(
          testGame,
          getNextFaction(testGame, currentFaction)!,
        ),
        isMate,
        san: formatSAN(piece, target, isCapture, checkResult, isGameOver),
      });

      if (isGameOverState(testGame.state)) {
        return solutionMoves;
      }
    } else {
      // Opponent's turn - let AI defend
      const move = calculateBestMove(testGame, currentFaction);
      if (!move) return null;

      const piece = move.piece;
      const target = move.target;

      const result = testGame.handleCellClick(piece.pos);
      if (!result) return null;

      testGame.handleCellClick(target);
    }
  }

  return null; // No forced mate found within depth
}

/**
 * Build a Puzzle object from a game position and solution.
 */
function buildPuzzle(
  initialGame: Game,
  solutionMoves: PuzzleMove[],
  mateIn: number,
  faction: Faction,
): Puzzle {
  return {
    id: `puzzle_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    fen: serializePosition(initialGame),
    initialMoves: [], // Could track moves from start position
    solution: solutionMoves,
    mateIn: Math.max(1, mateIn),
    difficulty: mateIn <= 2 ? "easy" : mateIn <= 4 ? "medium" : "hard",
    faction,
    createdAt: Date.now(),
  };
}

// ─── Puzzle Validation ────────────────────────────────────────────────────

/**
 * Validate that a puzzle is solvable and has a unique first-move solution.
 */
export async function validatePuzzle(puzzle: Puzzle): Promise<boolean> {
  const game = deserializePosition(puzzle.fen);
  if (!game) return false;

  // Verify the solution works
  const testGame = cloneGameForTest(game);
  for (const move of puzzle.solution) {
    const piece = testGame.getPieceAt(new Hex(move.from.q, move.from.r));
    if (!piece || piece.id !== move.pieceId) return false;

    const result = testGame.handleCellClick(piece.pos);
    if (!result) return false;

    const target = new Hex(move.to.q, move.to.r);
    const moveResult = testGame.handleCellClick(target);
    if (!moveResult) return false;
  }

  // Check that mate is delivered (full game over or last move marked mate)
  const last = puzzle.solution[puzzle.solution.length - 1];
  const solved = isGameOverState(testGame.state) || last?.isMate === true;
  if (!solved) return false;

  // Uniqueness of the first move (no alternative immediate mates)
  return hasUniqueSolution(puzzle);
}

// ─── Puzzle State Management ─────────────────────────────────────────────

let puzzleState: PuzzleState = {
  currentPuzzle: null,
  currentMoveIndex: 0,
  userMoves: [],
  startTime: 0,
  isComplete: false,
  isFailed: false,
  hintUsed: false,
};

export function getPuzzleState(): PuzzleState {
  return { ...puzzleState };
}

export function loadPuzzle(puzzle: Puzzle): void {
  puzzleState = {
    currentPuzzle: puzzle,
    currentMoveIndex: 0,
    userMoves: [],
    startTime: Date.now(),
    isComplete: false,
    isFailed: false,
    hintUsed: false,
  };
  saveProgress();
}

export function makePuzzleMove(
  game: Game,
  pieceId: string,
  target: Hex,
): { correct: boolean; expectedMove?: PuzzleMove; gameOver: boolean } {
  if (!puzzleState.currentPuzzle || puzzleState.isComplete) {
    return { correct: false, gameOver: false };
  }

  const expectedMove =
    puzzleState.currentPuzzle.solution[puzzleState.currentMoveIndex];
  if (!expectedMove) {
    return { correct: false, gameOver: true };
  }

  const isCorrect =
    pieceId === expectedMove.pieceId &&
    target.q === expectedMove.to.q &&
    target.r === expectedMove.to.r;

  if (isCorrect) {
    puzzleState.userMoves.push(expectedMove);
    puzzleState.currentMoveIndex++;

    // Check if puzzle is complete
    if (
      puzzleState.currentMoveIndex >= puzzleState.currentPuzzle.solution.length
    ) {
      puzzleState.isComplete = true;
      updatePuzzleStats(true);
      return { correct: true, gameOver: true };
    }

    return { correct: true, gameOver: false };
  } else {
    puzzleState.isFailed = true;
    updatePuzzleStats(false);
    return { correct: false, expectedMove, gameOver: false };
  }
}

export function requestHint(): PuzzleMove | null {
  if (!puzzleState.currentPuzzle || puzzleState.isComplete) return null;
  puzzleState.hintUsed = true;
  return (
    puzzleState.currentPuzzle.solution[puzzleState.currentMoveIndex] || null
  );
}

export function resetPuzzle(): void {
  if (puzzleState.currentPuzzle) {
    puzzleState.currentMoveIndex = 0;
    puzzleState.userMoves = [];
    puzzleState.startTime = Date.now();
    puzzleState.isComplete = false;
    puzzleState.isFailed = false;
    puzzleState.hintUsed = false;
  }
}

export function abandonPuzzle(): void {
  puzzleState = {
    currentPuzzle: null,
    currentMoveIndex: 0,
    userMoves: [],
    startTime: 0,
    isComplete: false,
    isFailed: false,
    hintUsed: false,
  };
}

// ─── Persistence ──────────────────────────────────────────────────────────

export function savePuzzles(puzzles: Puzzle[]): void {
  try {
    localStorage.setItem(PUZZLE_STORAGE_KEY, JSON.stringify(puzzles));
  } catch (e) {
    console.warn("Failed to save puzzles:", e);
  }
}

export function loadPuzzles(): Puzzle[] {
  try {
    const data = localStorage.getItem(PUZZLE_STORAGE_KEY);
    if (data) return JSON.parse(data);
  } catch (e) {
    console.warn("Failed to load puzzles:", e);
  }
  return [];
}

export function saveProgress(): void {
  try {
    const progress = {
      currentPuzzleId: puzzleState.currentPuzzle?.id,
      currentMoveIndex: puzzleState.currentMoveIndex,
      userMoves: puzzleState.userMoves,
      startTime: puzzleState.startTime,
      isComplete: puzzleState.isComplete,
      isFailed: puzzleState.isFailed,
      hintUsed: puzzleState.hintUsed,
    };
    localStorage.setItem(PUZZLE_PROGRESS_KEY, JSON.stringify(progress));
  } catch (e) {
    console.warn("Failed to save puzzle progress:", e);
  }
}

export function loadProgress(): PuzzleState | null {
  try {
    const data = localStorage.getItem(PUZZLE_PROGRESS_KEY);
    if (data) return JSON.parse(data);
  } catch (e) {
    console.warn("Failed to load puzzle progress:", e);
  }
  return null;
}

function updatePuzzleStats(solved: boolean): void {
  if (!puzzleState.currentPuzzle) return;

  const puzzles = loadPuzzles();
  const idx = puzzles.findIndex((p) => p.id === puzzleState.currentPuzzle!.id);
  if (idx >= 0) {
    const puzzle = puzzles[idx]!;
    puzzle.stats = puzzle.stats || {
      attempts: 0,
      solved: 0,
      avgTime: 0,
    };
    puzzle.stats!.attempts++;
    if (solved) puzzle.stats!.solved++;
    const elapsed = (Date.now() - puzzleState.startTime) / 1000;
    const prevAvg = puzzle.stats!.avgTime || 0;
    puzzle.stats!.avgTime =
      (prevAvg * (puzzle.stats!.attempts - 1) + elapsed) /
      puzzle.stats!.attempts;
    savePuzzles(puzzles);
  }
}

// ─── Utility Functions ────────────────────────────────────────────────────

function cloneGameForTest(game: Game): Game {
  const newGame = new Game();
  const cells = generateBoardForPuzzle();
  newGame.init(cells);

  // Copy pieces
  for (const piece of game.pieces) {
    const newPiece = newGame.pieces.find((p) => p.id === piece.id);
    if (newPiece) {
      newPiece.pos = new Hex(piece.pos.q, piece.pos.r);
      newPiece.alive = piece.alive;
      newPiece.hasMoved = piece.hasMoved;
      newPiece.type = piece.type;
      newPiece.faction = piece.faction;
      newPiece.symbol = piece.symbol;
    }
  }

  newGame.currentFactionIdx = game.currentFactionIdx;
  newGame.currentFaction = game.currentFaction;
  newGame.state = game.state;
  newGame.eliminatedFactions = new Set(game.eliminatedFactions);
  newGame._halfmoveClock = game._halfmoveClock;
  newGame._positionHistory = new Map(game._positionHistory);
  newGame._rebuildOccupiedMap();

  return newGame;
}

function getNextFaction(game: Game, current: Faction): Faction {
  const order: Faction[] = ["fire", "water", "nature"];
  const idx = order.indexOf(current);
  for (let i = 1; i <= 3; i++) {
    const next = order[(idx + i) % 3]!;
    if (!game.eliminatedFactions.has(next)) return next;
  }
  // Should never reach here if at least one faction alive
  return "fire";
}

export function formatSAN(
  piece: Piece,
  target: Hex,
  isCapture: boolean,
  isCheck: boolean,
  isMate: boolean,
): string {
  const pieceLetter =
    piece.type === "pawn" ? "" : (piece.type[0] ?? "").toUpperCase();
  const capture = isCapture ? "x" : "";
  const check = isMate ? "#" : isCheck ? "+" : "";
  return `${pieceLetter}${piece.pos.q},${piece.pos.r}${capture}${target.q},${target.r}${check}`;
}

function serializePosition(game: Game): string {
  const pieces = game
    .getAlivePieces()
    .map(
      (p) =>
        `${p.faction[0]?.toUpperCase() ?? ""}${p.type[0] ?? ""}${p.pos.q},${p.pos.r}`,
    )
    .join("|");
  return `${pieces}#${game.currentFactionIdx}`;
}

function deserializePosition(fen: string): Game | null {
  return reconstructGameFromHash(fen);
}

function shuffleArray<T>(array: T[]): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = array[i];
    array[i] = array[j]!;
    array[j] = temp!;
  }
}
function getBookStats() {
  return {
    positions: OPENING_BOOK.size,
    totalVariations: Array.from(OPENING_BOOK.values()).reduce(
      (sum, arr) => sum + arr.length,
      0,
    ),
  };
}

// ─── Daily Puzzle ────────────────────────────────────────────────────────

const DAILY_PUZZLE_KEY = "trischach-daily-puzzle";
const DAILY_PUZZLE_DATE_KEY = "trischach-daily-puzzle-date";
const STREAK_KEY = "trischach-puzzle-streak";

export interface PuzzleStreak {
  current: number;
  best: number;
  lastSolvedDate: string | null;
  totalDailySolved: number;
}

export function todayISO(now: Date = new Date()): string {
  return now.toISOString().split("T")[0]!;
}

function previousISO(date: string): string {
  const d = new Date(`${date}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0]!;
}

export function getPuzzleStreak(): PuzzleStreak {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<PuzzleStreak>;
      return {
        current: Number(s.current) || 0,
        best: Number(s.best) || 0,
        lastSolvedDate: s.lastSolvedDate ?? null,
        totalDailySolved: Number(s.totalDailySolved) || 0,
      };
    }
  } catch (e) {
    console.warn("Failed to load puzzle streak:", e);
  }
  return { current: 0, best: 0, lastSolvedDate: null, totalDailySolved: 0 };
}

function savePuzzleStreak(streak: PuzzleStreak): void {
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify(streak));
  } catch (e) {
    console.warn("Failed to save puzzle streak:", e);
  }
}

/** Whether today's daily puzzle was already solved (streak counted). */
export function isDailySolvedToday(date: string = todayISO()): boolean {
  return getPuzzleStreak().lastSolvedDate === date;
}

/** True if `puzzle` is the cached daily puzzle for today. */
export function isTodaysDailyPuzzle(puzzle: Puzzle): boolean {
  try {
    if (localStorage.getItem(DAILY_PUZZLE_DATE_KEY) !== todayISO()) {
      return false;
    }
    const data = localStorage.getItem(DAILY_PUZZLE_KEY);
    if (!data) return false;
    const daily = JSON.parse(data) as Puzzle;
    return daily.id === puzzle.id;
  } catch {
    return false;
  }
}

/**
 * Record a successful daily-puzzle solve. Idempotent for the same day.
 * Streak continues if the previous solve was yesterday; otherwise resets to 1.
 */
export function recordDailyPuzzleSolved(
  date: string = todayISO(),
): PuzzleStreak {
  const streak = getPuzzleStreak();
  if (streak.lastSolvedDate === date) {
    return streak;
  }

  if (streak.lastSolvedDate === previousISO(date)) {
    streak.current += 1;
  } else {
    streak.current = 1;
  }
  streak.best = Math.max(streak.best, streak.current);
  streak.lastSolvedDate = date;
  streak.totalDailySolved += 1;
  savePuzzleStreak(streak);
  return streak;
}

export async function getDailyPuzzle(): Promise<Puzzle | null> {
  const today = todayISO();
  const storedDate = localStorage.getItem(DAILY_PUZZLE_DATE_KEY);

  if (storedDate === today) {
    try {
      const data = localStorage.getItem(DAILY_PUZZLE_KEY);
      if (data) return JSON.parse(data);
    } catch {
      // Fall through to generate new
    }
  }

  // Generate new daily puzzle
  return generateDailyPuzzle(today);
}

async function generateDailyPuzzle(date: string): Promise<Puzzle | null> {
  const puzzles = await generatePuzzlesFromBook(10);
  if (puzzles.length === 0) return null;

  // Prefer medium; all generated puzzles already passed validatePuzzle.
  const mediumPuzzles = puzzles.filter((p) => p.difficulty === "medium");
  const daily =
    mediumPuzzles.length > 0
      ? mediumPuzzles[Math.floor(Math.random() * mediumPuzzles.length)]!
      : puzzles[0]!;

  try {
    localStorage.setItem(DAILY_PUZZLE_KEY, JSON.stringify(daily));
    localStorage.setItem(DAILY_PUZZLE_DATE_KEY, date);
  } catch (e) {
    console.warn("Failed to save daily puzzle:", e);
  }

  return daily;
}

// ─── Export for debugging ────────────────────────────────────────────────

export {
  PUZZLE_STORAGE_KEY,
  PUZZLE_PROGRESS_KEY,
  DAILY_PUZZLE_KEY,
  DAILY_PUZZLE_DATE_KEY,
  STREAK_KEY,
};
