/**
 * TriSchach Main Entry Point - TypeScript
 * Main application logic, UI handling, AI worker management, replay system
 */

import {
  BoardRenderer,
  FACTION_COLORS,
  FACTION,
  generateBoard,
} from "./board.ts";
import {
  Game,
  GAME_STATE,
  PROMOTION_CHOICES,
  GameResult,
  Piece,
} from "./game.ts";
import {
  calculateBestMove,
  evaluateBoard,
  setAIDepth,
  setAIPersonality,
  getAIPersonalities,
  buildOpeningBook,
  // Pondering
  startPondering,
  stopPondering,
  isPondering,
} from "./ai.ts";
import {
  learnFromGame,
  loadLearnedDataFromStorage,
  saveLearnedDataToStorage,
  loadOpeningBook,
  loadLearnedDataFromFile,
} from "./opening-book.ts";
import { sounds } from "./sounds.ts";
import {
  serializeGame,
  downloadGame,
  copyGameToClipboard,
  loadGameFromFile,
  parseTSPN,
  reconstructGameFromTSPN,
  ReplayController,
} from "./replay.ts";
import {
  generatePuzzlesFromBook,
  loadPuzzle,
  getPuzzleState,
  makePuzzleMove,
  requestHint,
  resetPuzzle,
  abandonPuzzle,
  getDailyPuzzle,
  Puzzle,
  PuzzleMove,
  PuzzleState,
} from "./puzzle.ts";
import { Hex } from "./hex.ts";

// ─── Global Type Augmentation ────────────────────────────────────────

declare global {
  interface Window {
    replayController?: ReplayController;
  }
}

// ─── Settings Persistence (localStorage) ────────────────────────────────

const STORAGE_KEY = "trischach-settings";

interface GameSettings {
  rpsEnabled: boolean;
  soundEnabled: boolean;
  aiDepth: 1 | 2 | 3 | 4;
  boardRotation: number;
  autoBattle: boolean;
  aiPersonality: "balanced" | "aggressive" | "defensive" | "tactical";
  autoQueen?: boolean;
  // Auto-Battle Learning settings
  abGames?: number;
  abDepth?: number;
  abMaxMoves?: number;
  abPersonalities?: string[];
}

const DEFAULT_SETTINGS: GameSettings = {
  rpsEnabled: true,
  soundEnabled: true,
  aiDepth: 3,
  boardRotation: 0,
  autoBattle: false,
  aiPersonality: "balanced",
  autoQueen: false,
  abGames: 100,
  abDepth: 4,
  abMaxMoves: 300,
  abPersonalities: ["balanced", "aggressive", "defensive", "tactical"],
};

const depthNames: Record<number, string> = {
  1: "Leicht",
  2: "Mittel",
  3: "Schwer",
  4: "Extrem",
};

function loadSettings(): GameSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.warn("Failed to load settings:", e);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn("Failed to save settings:", e);
  }
}

// ─── DOM Elements ───────────────────────────────────────────────────

const svg = document.getElementById("board-svg") as unknown as SVGSVGElement;
const statusEl = document.getElementById("status") as HTMLElement;
const turnEl = document.getElementById("turn-indicator") as HTMLElement;
const rpsInfoEl = document.getElementById("rps-info") as HTMLElement;
const combatOverlay = document.getElementById("combat-overlay") as HTMLElement;
const promotionOverlay = document.getElementById(
  "promotion-overlay",
) as HTMLElement;
const puzzleOverlay = document.getElementById("puzzle-overlay") as HTMLElement;

const restartBtn = document.getElementById("restart-btn") as HTMLButtonElement;
const autoBattleBtn = document.getElementById(
  "auto-battle-btn",
) as HTMLButtonElement;
const rpsToggle = document.getElementById("rps-toggle") as HTMLInputElement;
const soundToggle = document.getElementById("sound-toggle") as HTMLInputElement;
const rotateBtn = document.getElementById("rotate-btn") as HTMLButtonElement;
const moveLogEl = document.getElementById("move-log") as HTMLElement;

const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
const loadBtn = document.getElementById("load-btn") as HTMLButtonElement;
const copyBtn = document.getElementById("copy-btn") as HTMLButtonElement;
const puzzleBtn = document.getElementById("puzzle-btn") as HTMLButtonElement;
const settingsBtn = document.getElementById(
  "settings-btn",
) as HTMLButtonElement;
const settingsOverlay = document.getElementById(
  "settings-overlay",
) as HTMLElement;
const settingsCloseBtn = document.getElementById(
  "settings-close",
) as HTMLButtonElement;
const settingsTabs = document.querySelectorAll(".settings-tab");
const settingsPanels = document.querySelectorAll(".settings-panel");
const darkModeBtn = document.getElementById(
  "darkmode-btn",
) as HTMLButtonElement;

const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = ".tspn,text/plain";
fileInput.style.display = "none";
document.body.appendChild(fileInput);

const personalitySelect = document.getElementById(
  "personality-select",
) as HTMLSelectElement;

const renderer = new BoardRenderer(svg);
const game = new Game();

// ─── AI Worker ──────────────────────────────────────────────────────

interface WorkerMove {
  pieceId: string;
  targetQ: number;
  targetR: number;
  moveType: string;
  rps: string;
}

interface GameStateForWorker {
  pieces: Array<{
    id: string;
    type: string;
    faction: string;
    pos: { q: number; r: number };
    symbol: string;
    alive: boolean;
    hasMoved: boolean;
  }>;
  currentFactionIdx: number;
  currentFaction: string;
  state: string;
  eliminatedFactions: string[];
  rpsEnabled: boolean;
  capturedPieces: Record<string, string[]>;
  _halfmoveClock: number;
}

let aiWorker: Worker | null = null;
let workerReady = false;
let pendingWorkerCallback: ((move: WorkerMove | null) => void) | null = null;

function initAIWorker(): void {
  try {
    aiWorker = new Worker("./ai-worker.js", { type: "module" });
    aiWorker.onmessage = (e: MessageEvent) => {
      const { type, move, depth, score, nodes } = e.data;
      if (type === "result" && pendingWorkerCallback) {
        pendingWorkerCallback(move);
        pendingWorkerCallback = null;
      } else if (type === "progress") {
        console.log(`AI depth ${depth}: score ${score}, nodes ${nodes}`);
      } else if (type === "bookReady") {
        workerReady = true;
      } else if (type === "ponderReady") {
        // Worker pondering ready
      } else if (type === "ponderResult") {
        // Worker returned a pondered move - could use it
        console.log("Worker ponder result:", move);
      }
    };
    aiWorker.onerror = (err: ErrorEvent) => {
      console.warn("AI Worker error, falling back to main thread:", err);
      aiWorker = null;
    };
    aiWorker.postMessage({ type: "initBook" });
  } catch (e) {
    console.warn("Web Worker not supported, using main thread AI");
    aiWorker = null;
  }
}

function calculateBestMoveWorker(
  game: Game,
  faction: string,
): Promise<WorkerMove | null> {
  return new Promise((resolve) => {
    if (!aiWorker || !workerReady) {
      const move = calculateBestMove(game, faction);
      if (move) {
        resolve({
          pieceId: move.piece.id,
          targetQ: move.target.q,
          targetR: move.target.r,
          moveType: move.type,
          rps: move.rps,
        });
      } else {
        resolve(null);
      }
      return;
    }
    pendingWorkerCallback = resolve;
    const gameState = serializeGameForWorker(game);
    aiWorker!.postMessage({ type: "calculate", gameState, faction });
  });
}

function serializeGameForWorker(game: Game): GameStateForWorker {
  return {
    pieces: game.getAlivePieces().map((p) => ({
      id: p.id,
      type: p.type,
      faction: p.faction,
      pos: { q: p.pos.q, r: p.pos.r },
      symbol: p.symbol,
      alive: p.alive,
      hasMoved: p.hasMoved,
    })),
    currentFactionIdx: game.currentFactionIdx,
    currentFaction: game.currentFaction,
    state: game.state,
    eliminatedFactions: Array.from(game.eliminatedFactions),
    rpsEnabled: game.rpsEnabled,
    capturedPieces: {
      fire: game.capturedPieces[FACTION.FIRE].map((p) => p.id),
      water: game.capturedPieces[FACTION.WATER].map((p) => p.id),
      nature: game.capturedPieces[FACTION.NATURE].map((p) => p.id),
    },
    _halfmoveClock: game._halfmoveClock || 0,
  };
}

// ─── Global State ───────────────────────────────────────────────────

let autoBattleActive = false;
let autoBattleTimer: any = null;
let currentBoardRotation = 0;

// Track opening book moves for learning
interface BookMoveRecord {
  hash: string;
  faction: string;
  move: { pieceId: string; targetQ: number; targetR: number };
}
let autoBattleBookMoves: BookMoveRecord[] = [];

// ─── Initialization ─────────────────────────────────────────────────

function applySettings(settings: GameSettings): void {
  game.rpsEnabled = settings.rpsEnabled;
  const rpsToggle = document.getElementById("rps-toggle") as HTMLInputElement;
  if (rpsToggle) rpsToggle.checked = settings.rpsEnabled;

  sounds.toggle(settings.soundEnabled);
  const soundToggle = document.getElementById(
    "sound-toggle",
  ) as HTMLInputElement;
  if (soundToggle) soundToggle.checked = settings.soundEnabled;

  setAIDepth(settings.aiDepth);
  const depthSlider = document.getElementById(
    "depth-slider",
  ) as HTMLInputElement;
  const depthLabel = document.getElementById("depth-label") as HTMLElement;
  if (depthSlider) depthSlider.value = String(settings.aiDepth);
  if (depthLabel)
    depthLabel.textContent = "KI: " + depthNames[settings.aiDepth];

  currentBoardRotation = settings.boardRotation % 360;
  renderer.setRotation(currentBoardRotation);

  autoBattleActive = settings.autoBattle;
  const autoBattleBtn = document.getElementById(
    "auto-battle-btn",
  ) as HTMLButtonElement;
  if (autoBattleBtn) {
    if (autoBattleActive) {
      autoBattleBtn.textContent = "⏹ Auto Battle Stoppen";
      autoBattleBtn.classList.add("active");
    } else {
      autoBattleBtn.textContent = "🤖 Auto Battle";
      autoBattleBtn.classList.remove("active");
    }
  }

  setAIPersonality(settings.aiPersonality);
  const personalitySelect = document.getElementById(
    "personality-select",
  ) as HTMLSelectElement;
  if (personalitySelect) personalitySelect.value = settings.aiPersonality;

  updateUI();
}

function init(): void {
  renderer.render();
  game.init(renderer.cells);
  game.clearUndoStack();
  autoBattleBookMoves = []; // Clear learning tracking

  // Load production opening book + learned data
  (async () => {
    await loadOpeningBook(); // Load compiled book from JSON
    await loadLearnedDataFromFile(); // Load auto-battle learned data from file
    loadLearnedDataFromStorage(); // Merge localStorage learned data
    initAIWorker();
    const settings = loadSettings();
    applySettings(settings);

    if (game.boardCells) {
      for (const [key, cell] of renderer.hexElements) {
        const c = game.boardCells.get(key);
        if (c)
          cell.polygon.setAttribute("title", `Coord: ${c.hex.q},${c.hex.r}`);
      }
    }

    for (const p of game.getAlivePieces()) renderer.renderPiece(p);
    updateUI();
  })();
}

function updateUI(): void {
  const f = game.currentFaction;
  const fc = FACTION_COLORS[f];
  const turnEl = document.getElementById("turn-indicator") as HTMLElement;
  const statusEl = document.getElementById("status") as HTMLElement;
  if (turnEl) {
    turnEl.textContent = fc.name;
    turnEl.style.color = fc.primary;
  }

  if (game.state === GAME_STATE.GAME_OVER) {
    // keep existing game over text
  } else if (game.isKingInCheck(f)) {
    if (statusEl) {
      statusEl.textContent = "⚠️ Schach!";
      statusEl.style.color = "#ff4444";
    }
  } else {
    if (statusEl) {
      statusEl.textContent =
        game.state === GAME_STATE.SELECT_PIECE
          ? "Wähle eine Figur"
          : "Wähle ein Ziel";
      statusEl.style.color = "";
    }
  }

  clearCheckHighlight();
  if (game.isKingInCheck(f)) {
    const king = game.pieces.find(
      (p) => p.faction === f && p.type === "king" && p.alive,
    );
    if (king) {
      const el = renderer.hexElements.get(king.pos.key);
      if (el) el.polygon.classList.add("highlight-check");
    }
  }

  for (const fac of [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]) {
    const el = document.getElementById(`panel-${fac}`);
    if (el && game.eliminatedFactions.has(fac)) el.classList.add("eliminated");
  }

  const rpsInfoEl = document.getElementById("rps-info") as HTMLElement;
  if (game.rpsEnabled) {
    rpsInfoEl.classList.remove("rps-inactive");
    document
      .querySelectorAll(".rps-hint")
      .forEach((el) => el.classList.remove("hidden"));
  } else {
    rpsInfoEl.classList.add("rps-inactive");
    document
      .querySelectorAll(".rps-hint")
      .forEach((el) => el.classList.add("hidden"));
  }

  for (const fac of [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]) {
    const capEl = document.getElementById(`captures-${fac}`);
    if (capEl) {
      capEl.innerHTML = game.capturedPieces[fac]
        .map((p) => `<span class="captured-piece">${p.symbol}</span>`)
        .join("");
    }
  }

  updateEvalBar();
}

function updateEvalBar(): void {
  const fireEval = evaluateBoard(game, FACTION.FIRE);
  const natureEval = evaluateBoard(game, FACTION.NATURE);
  const waterEval = evaluateBoard(game, FACTION.WATER);

  const minEval = Math.min(fireEval, natureEval, waterEval);
  const shifted: [number, number, number] = [
    fireEval - minEval,
    natureEval - minEval,
    waterEval - minEval,
  ];
  const maxShifted = Math.max(...shifted, 1);

  const firePct = (shifted[0] / maxShifted) * 100;
  const naturePct = (shifted[1] / maxShifted) * 100;
  const waterPct = (shifted[2] / maxShifted) * 100;

  const evalFire = document.getElementById("eval-fire") as HTMLElement;
  const evalNature = document.getElementById("eval-nature") as HTMLElement;
  const evalWater = document.getElementById("eval-water") as HTMLElement;
  if (evalFire) evalFire.style.width = firePct + "%";
  if (evalNature) evalNature.style.width = naturePct + "%";
  if (evalWater) evalWater.style.width = waterPct + "%";
}

function clearCheckHighlight(): void {
  document
    .querySelectorAll(".highlight-check")
    .forEach((el) => el.classList.remove("highlight-check"));
}

function addToLog(result: GameResult): void {
  if (!result.piece) return;
  const moveLogEl = document.getElementById("move-log") as HTMLElement;
  const entry = document.createElement("div");
  entry.className = `move-entry ${result.piece.faction}`;
  entry.innerHTML = `
    <span class="move-piece">${result.piece.symbol}</span>
    <span class="move-coords">${result.notation}</span>
  `;
  moveLogEl.appendChild(entry);
  moveLogEl.scrollTop = moveLogEl.scrollHeight;
}

// ─── Cell Click Handler ──────────────────────────────────────────────

renderer.onCellClick = (hex: { q: number; r: number }) => {
  const hexObj = new Hex(hex.q, hex.r);
  const result = game.handleCellClick(hexObj);
  if (!result) return;

  renderer.clearHighlights();
  renderer.clearSelection();

  if (result.action === "select") {
    sounds.playSelect();
    renderer.selectCell(hexObj);
    renderer.highlightCells(result.moves ?? [], "highlight-move");
    if (game.rpsEnabled && result.rpsAttacks) {
      renderer.highlightCells(
        result.rpsAttacks.advantage ?? [],
        "highlight-attack-advantage",
      );
      renderer.highlightCells(
        result.rpsAttacks.disadvantage ?? [],
        "highlight-attack-disadvantage",
      );
      renderer.highlightCells(
        result.rpsAttacks.neutral ?? [],
        "highlight-attack",
      );
    } else {
      renderer.highlightCells(result.attacks ?? [], "highlight-attack");
    }
  } else if (result.action === "deselect") {
    // nothing
  } else if (result.action === "move") {
    sounds.playMove();
    addToLog(result);
    if (result.piece) renderer.renderPiece(result.piece);

    // Start pondering for AI after human move
    if (game.state !== GAME_STATE.GAME_OVER) {
      startPondering(game, game.currentFaction);
    }

    if (result.promotion && game.pendingPromotion) {
      showPromotion(game.pendingPromotion);
    } else {
      updateUI();
    }
  } else if (result.action === "combat") {
    addToLog(result);
    showCombat(result);

    // Start pondering for AI after combat
    if (game.state !== GAME_STATE.GAME_OVER) {
      startPondering(game, game.currentFaction);
    }
  }

  if (
    result.inCheck &&
    result.action !== "select" &&
    result.action !== "deselect"
  ) {
    sounds.playCheck();
  }

  if (result.action === "select" || result.action === "deselect") updateUI();
};

// ─── Context Menu ────────────────────────────────────────────────────

let contextMenuPiece: Piece | null = null;

renderer.onPieceLongPress = (
  piece: Piece,
  position: { clientX: number; clientY: number },
) => {
  if (game.state === GAME_STATE.GAME_OVER) return;
  if (piece.faction !== game.currentFaction) return;

  contextMenuPiece = piece;
  showContextMenu(piece, position);
};

function showContextMenu(
  piece: Piece,
  position: { clientX: number; clientY: number },
): void {
  const existing = document.getElementById("piece-context-menu");
  if (existing) existing.remove();

  const { moves, attacks } = game.getLegalMoves(piece);
  const hasMoves = moves.length > 0 || attacks.length > 0;

  const menu = document.createElement("div");
  menu.id = "piece-context-menu";
  menu.className = "piece-context-menu";
  menu.style.left = `${position.clientX}px`;
  menu.style.top = `${position.clientY}px`;

  let itemsHtml = "";
  itemsHtml += `<div class="context-menu-header">${piece.symbol} ${piece.type} (${piece.faction})</div>`;
  itemsHtml += '<div class="context-menu-divider"></div>';

  if (hasMoves) {
    itemsHtml += `<button class="context-menu-item" data-action="show-moves">
      <span class="context-menu-icon">🎯</span> Mögliche Züge anzeigen
    </button>`;
  }

  itemsHtml += `<button class="context-menu-item" data-action="undo">
    <span class="context-menu-icon">↩️</span> Zug zurücknehmen
  </button>`;

  itemsHtml += `<button class="context-menu-item" data-action="save">
    <span class="context-menu-icon">💾</span> Spiel speichern
  </button>`;

  itemsHtml += `<button class="context-menu-item" data-action="copy">
    <span class="context-menu-icon">📋</span> TSPN kopieren
  </button>`;

  itemsHtml += '<div class="context-menu-divider"></div>';
  itemsHtml += `<button class="context-menu-item context-menu-danger" data-action="deselect">
    <span class="context-menu-icon">✕</span> Abbrechen
  </button>`;

  menu.innerHTML = itemsHtml;
  document.body.appendChild(menu);

  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (rect.right > viewportWidth - 10) {
      menu.style.left = `${viewportWidth - rect.width - 10}px`;
    }
    if (rect.bottom > viewportHeight - 10) {
      menu.style.top = `${viewportHeight - rect.height - 10}px`;
    }
  });

  menu.querySelectorAll(".context-menu-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      handleContextMenuAction((btn as HTMLElement).dataset.action, piece);
      hideContextMenu();
    });
  });

  const closeOnClick = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      hideContextMenu();
      document.removeEventListener("click", closeOnClick);
    }
  };
  setTimeout(() => document.addEventListener("click", closeOnClick), 0);
}

function handleContextMenuAction(
  action: string | undefined,
  piece: {
    id: string;
    type: string;
    faction: string;
    pos: Hex;
    symbol: string;
  },
): void {
  if (!action) return;

  switch (action) {
    case "show-moves": {
      const selectResult = game.handleCellClick(piece.pos);
      if (selectResult && selectResult.action === "select") {
        renderer.clearHighlights();
        renderer.selectCell(piece.pos);
        renderer.highlightCells(selectResult.moves ?? [], "highlight-move");
        if (game.rpsEnabled && selectResult.rpsAttacks) {
          renderer.highlightCells(
            selectResult.rpsAttacks.advantage ?? [],
            "highlight-attack-advantage",
          );
          renderer.highlightCells(
            selectResult.rpsAttacks.disadvantage ?? [],
            "highlight-attack-disadvantage",
          );
          renderer.highlightCells(
            selectResult.rpsAttacks.neutral ?? [],
            "highlight-attack",
          );
        } else {
          renderer.highlightCells(
            selectResult.attacks ?? [],
            "highlight-attack",
          );
        }
        updateUI();
      }
      break;
    }
    case "undo": {
      const snap = game.undo();
      if (snap) updateUI();
      break;
    }
    case "save": {
      downloadGame(
        game,
        `trischach-${new Date().toISOString().slice(0, 10)}.tspn`,
      );
      break;
    }
    case "copy": {
      navigator.clipboard
        .writeText(window.replayController?.exportTSPN() || "")
        .then(() => {
          console.log("TSPN copied to clipboard");
        });
      break;
    }
  }
}

function hideContextMenu(): void {
  const existing = document.getElementById("piece-context-menu");
  if (existing) existing.remove();
}

// ─── Auto-Battle ────────────────────────────────────────────────────

function triggerAutoMove(): void {
  if (autoBattleTimer) clearTimeout(autoBattleTimer);
  autoBattleTimer = setTimeout(async () => {
    if (!autoBattleActive || game.state === "game_over") return;

    if (game.state === "select_target" && game.selectedPiece) {
      game.handleCellClick(game.selectedPiece.pos);
    }

    if (game.eliminatedFactions.has(game.currentFaction)) {
      game._nextTurn();
      triggerAutoMove();
      return;
    }

    // Check if current position is in opening book before making move
    const { inBook, pickBookMove } = await import("./opening-book.ts");
    const wasInBook = inBook(game);
    const bookMove = wasInBook ? pickBookMove(game) : null;

    // Stop pondering and get the best move found
    const ponderMove = await stopPondering();

    let action;
    if (ponderMove) {
      action = {
        pieceId: ponderMove.piece.id,
        targetQ: ponderMove.target.q,
        targetR: ponderMove.target.r,
        moveType: ponderMove.type,
        rps: ponderMove.rps,
      };
    } else {
      action = await calculateBestMoveWorker(game, game.currentFaction);
    }

    if (action) {
      const piece = game.pieces.find((p) => p.id === action.pieceId);
      if (!piece) {
        triggerAutoMove();
        return;
      }

      // Record book move for learning if it was a book move
      if (wasInBook && bookMove && bookMove.piece.id === piece.id) {
        const { boardHash } = await import("./opening-book.ts");
        const hash = boardHash(game);
        autoBattleBookMoves.push({
          hash,
          faction: game.currentFaction,
          move: {
            pieceId: piece.id,
            targetQ: action.targetQ,
            targetR: action.targetR,
          },
        });
      }

      game.handleCellClick(piece.pos);
      const { Hex } = await import("./hex.ts");
      const target = new Hex(action.targetQ, action.targetR);
      const result = game.handleCellClick(target);

      renderer.clearHighlights();
      renderer.clearSelection();

      if (result && result.action === "move") {
        sounds.playMove();
        addToLog(result);
        const movedPiece = result.piece;
        if (movedPiece) renderer.renderPiece(movedPiece);
        if (result.promotion) {
          const promoResult = game.completePromotion("queen");
          if (promoResult && movedPiece) {
            renderer.removePiece(movedPiece.id);
            renderer.renderPiece(movedPiece);
            addToLog(promoResult);
          }
          updateUI();

          // Start pondering for next AI move
          // @ts-expect-error - GameState union comparison with string literal
          if (game.state !== "game_over") {
            startPondering(game, game.currentFaction);
          }
          triggerAutoMove();
        } else {
          updateUI();

          // Start pondering for next AI move
          // @ts-expect-error - GameState union comparison with string literal
          if (game.state !== "game_over") {
            startPondering(game, game.currentFaction);
          }
          triggerAutoMove();
        }
      } else if (result && result.action === "combat") {
        addToLog(result);
        showCombat(result);
      } else {
        autoBattleActive = false;
        const autoBattleBtn = document.getElementById(
          "auto-battle-btn",
        ) as HTMLButtonElement;
        if (autoBattleBtn) {
          autoBattleBtn.textContent = "🤖 Auto Battle";
          autoBattleBtn.classList.remove("active");
        }
        updateUI();
      }
    } else {
      const aliveFactions = [
        FACTION.FIRE,
        FACTION.WATER,
        FACTION.NATURE,
      ].filter((f) => !game.eliminatedFactions.has(f));
      if (aliveFactions.length <= 1) {
        game.state = "game_over";
        updateUI();
      } else {
        game._nextTurn();
        triggerAutoMove();
      }
    }
  }, 400);
}

// ─── Combat Overlay ─────────────────────────────────────────────────

function showCombat(result: GameResult): void {
  const piece = result.piece;
  const defender = result.defender;
  if (!piece || !defender) return;
  const combatOverlay = document.getElementById(
    "combat-overlay",
  ) as HTMLElement;
  const attColor = FACTION_COLORS[piece.faction];
  const defColor = FACTION_COLORS[defender.faction];
  const rps = result.rpsResult;

  sounds.playCombat();

  combatOverlay.innerHTML = `
    <div class="combat-box">
      <div class="combat-fighters">
        <div class="fighter" style="color:${attColor.primary}">
          <span class="fighter-symbol">${piece.symbol}</span>
          <span class="fighter-name">${attColor.name}</span>
        </div>
        <div class="combat-vs">${rps === "advantage" ? ">" : "<"}</div>
        <div class="fighter" style="color:${defColor.primary}">
          <span class="fighter-symbol">${defender.symbol}</span>
          <span class="fighter-name">${defColor.name}</span>
        </div>
      </div>
      <div class="combat-result ${rps}">
        ${
          rps === "advantage"
            ? `${attColor.name} besiegt ${defColor.name}!`
            : `${defColor.name} wehrt ab! ${attColor.name} verliert!`
        }
      </div>
      ${result.elimination ? `<div class="combat-elimination">💀 ${FACTION_COLORS[result.elimination].name} ist eliminiert!</div>` : ""}
      ${result.checkmate ? `<div class="combat-checkmate">♚ Schachmatt! ${FACTION_COLORS[result.checkmate].name} ist eliminiert!</div>` : ""}
      ${result.stalemate ? `<div class="combat-stalemate">🤖 Patt! ${FACTION_COLORS[result.stalemate].name} ist eliminiert!</div>` : ""}
      ${result.inCheck && !result.checkmate ? `<div class="combat-check">⚠️ Schach!</div>` : ""}
      ${result.gameOver ? `<div class="combat-winner">🏆 ${FACTION_COLORS[result.winner_faction!].name} gewinnt!</div>` : ""}
      ${autoBattleActive && !result.gameOver ? `<button id="stop-auto-combat" class="combat-stop-btn">⏹ Auto Battle Stoppen</button>` : ""}
    </div>
  `;
  combatOverlay.classList.add("visible");

  const stopBtn = document.getElementById("stop-auto-combat");
  if (stopBtn) {
    stopBtn.onclick = () => {
      autoBattleActive = false;
      const autoBattleBtn = document.getElementById(
        "auto-battle-btn",
      ) as HTMLButtonElement;
      if (autoBattleBtn) {
        autoBattleBtn.textContent = "🤖 Auto Battle";
        autoBattleBtn.classList.remove("active");
      }
      clearTimeout(autoBattleTimer!);
      stopBtn.remove();
    };
  }

  setTimeout(() => {
    const combatOverlay = document.getElementById(
      "combat-overlay",
    ) as HTMLElement;
    const boardGroup = document.getElementById("board-group");
    combatOverlay.classList.remove("visible");
    if (boardGroup) {
      boardGroup.querySelectorAll(".piece").forEach((el) => el.remove());
    }
    renderer.pieceElements.clear();
    for (const p of game.getAlivePieces()) renderer.renderPiece(p);
    updateUI();
    if (result.elimination) sounds.playElimination();
    if (result.stalemate) sounds.playStalemate();

    if (result.gameOver) {
      sounds.playWin();
      const statusEl = document.getElementById("status") as HTMLElement;
      if (statusEl) {
        statusEl.textContent = `🏆 ${FACTION_COLORS[result.winner_faction!].name} hat gewonnen!`;
      }
      autoBattleActive = false;
      const autoBattleBtn = document.getElementById(
        "auto-battle-btn",
      ) as HTMLButtonElement;
      if (autoBattleBtn) {
        autoBattleBtn.textContent = "🤖 Auto Battle";
        autoBattleBtn.classList.remove("active");
      }

      // Learn from this game if there were book moves
      if (autoBattleBookMoves.length > 0) {
        const winnerFaction = result.winner_faction;
        learnFromGame(autoBattleBookMoves, winnerFaction);
        saveLearnedDataToStorage();
        console.log(
          `Opening book: Learned from auto-battle game (${autoBattleBookMoves.length} book moves, winner: ${winnerFaction || "draw"})`,
        );
        autoBattleBookMoves = [];
      }
    } else if (autoBattleActive) {
      triggerAutoMove();
    }
  }, 2200);
}

// ─── Promotion Overlay ──────────────────────────────────────────────

function showPromotion(piece: Piece): void {
  const color = FACTION_COLORS[piece.faction];
  const names = {
    queen: "Dame",
    rook: "Turm",
    bishop: "Läufer",
    knight: "Springer",
  };
  const symbols = { queen: "♛", rook: "♜", bishop: "♝", knight: "♞" };
  const keyHints = { queen: "Q", rook: "R", bishop: "B", knight: "N" };

  const settings = loadSettings();
  const autoQueen = settings.autoQueen === true;

  const promotionOverlay = document.getElementById(
    "promotion-overlay",
  ) as HTMLElement;
  promotionOverlay.innerHTML = `
    <div class="promotion-box">
      <div class="promotion-title" style="color:${color.primary}">
        Bauer promoviert! Wähle eine Figur:
      </div>
      <div class="promotion-preview" id="promotion-preview" style="color:${color.primary}; min-height: 80px; display: flex; align-items: center; justify-content: center; margin: 10px 0;">
        <span class="preview-symbol" style="font-size: 64px; opacity: 0.3; transition: all 0.15s ease;">${symbols.queen}</span>
        <span class="preview-name" style="font-size: 18px; margin-left: 12px; font-weight: bold; opacity: 0; transition: opacity 0.15s ease;"></span>
      </div>
      <div class="promotion-choices">
        ${(
          PROMOTION_CHOICES as readonly (
            | "queen"
            | "rook"
            | "bishop"
            | "knight"
          )[]
        )
          .map(
            (type: "queen" | "rook" | "bishop" | "knight") => `
          <button class="promotion-choice" data-type="${type}" data-key="${keyHints[type]}" style="border-color:${color.primary}" title="${names[type]} (Taste: ${keyHints[type]})">
            <span class="choice-symbol">${symbols[type]}</span>
            <span class="choice-name">${names[type]}</span>
            <span class="choice-key">${keyHints[type]}</span>
          </button>
        `,
          )
          .join("")}
      </div>
      <div class="promotion-options">
        <label class="auto-queen-label">
          <input type="checkbox" id="auto-queen-checkbox" ${autoQueen ? "checked" : ""}>
          <span>Immer automatisch zur Dame promovieren</span>
        </label>
      </div>
    </div>
  `;
  promotionOverlay.classList.add("visible");

  // Preview hover handlers
  const previewEl = document.getElementById("promotion-preview");
  const previewSymbol = previewEl?.querySelector(
    ".preview-symbol",
  ) as HTMLElement;
  const previewName = previewEl?.querySelector(".preview-name") as HTMLElement;

  if (previewEl && previewSymbol && previewName) {
    promotionOverlay.querySelectorAll(".promotion-choice").forEach((btn) => {
      btn.addEventListener("mouseenter", () => {
        const type = (btn as HTMLElement).dataset.type as
          | "queen"
          | "rook"
          | "bishop"
          | "knight"
          | undefined;
        if (!type) return;
        previewSymbol.textContent = symbols[type];
        previewName.textContent = names[type];
        previewSymbol.style.opacity = "1";
        previewSymbol.style.transform = "scale(1.2)";
        previewName.style.opacity = "1";
      });
      btn.addEventListener("mouseleave", () => {
        previewSymbol.style.opacity = "0.3";
        previewSymbol.style.transform = "scale(1)";
        previewName.style.opacity = "0";
      });
    });
  }

  const autoQueenCheckbox = document.getElementById(
    "auto-queen-checkbox",
  ) as HTMLInputElement;
  if (autoQueenCheckbox) {
    autoQueenCheckbox.addEventListener("change", (e: Event) => {
      const settings = loadSettings();
      settings.autoQueen = (e.target as HTMLInputElement).checked;
      saveSettings(settings);
    });
  }

  if (autoQueen) {
    setTimeout(() => {
      const promotionOverlay = document.getElementById(
        "promotion-overlay",
      ) as HTMLElement;
      promotionOverlay.classList.remove("visible");
      const result = game.completePromotion("queen");
      if (result) {
        handlePromotionResult(result, piece);
      }
    }, 100);
    return;
  }

  promotionOverlay.querySelectorAll(".promotion-choice").forEach((btn) => {
    btn.addEventListener("click", () => {
      const newType = (btn as HTMLElement).dataset.type;
      if (!newType) return;
      promotionOverlay.classList.remove("visible");
      const result = game.completePromotion(
        newType as "queen" | "rook" | "bishop" | "knight",
      );
      if (result) {
        handlePromotionResult(result, piece);
      }
    });
  });

  const keyHandler = (e: KeyboardEvent) => {
    if (!promotionOverlay.classList.contains("visible")) return;

    const key = e.key.toLowerCase();
    const keyMap: Record<string, "queen" | "rook" | "bishop" | "knight"> = {
      q: "queen",
      r: "rook",
      b: "bishop",
      n: "knight",
    };

    if (keyMap[key]) {
      e.preventDefault();
      promotionOverlay.classList.remove("visible");
      const result = game.completePromotion(keyMap[key]);
      if (result) {
        handlePromotionResult(result, piece);
      }
      document.removeEventListener("keydown", keyHandler);
    }
  };

  document.addEventListener("keydown", keyHandler);

  const cleanup = () => {
    document.removeEventListener("keydown", keyHandler);
    promotionOverlay.removeEventListener("transitionend", cleanup);
  };
  promotionOverlay.addEventListener("transitionend", cleanup);
}

function handlePromotionResult(result: GameResult | null, piece: Piece): void {
  if (!result) return;
  addToLog(result);
  renderer.removePiece(piece.id);
  renderer.renderPiece(piece);
  updateUI();
  sounds.playPromotion();
}

// ─── Auto-Battle Button ────────────────────────────────────────────

function initEventListeners(): void {
  const autoBattleBtn = document.getElementById(
    "auto-battle-btn",
  ) as HTMLButtonElement;
  autoBattleBtn?.addEventListener("click", () => {
    if (game.state === "game_over") return;
    autoBattleActive = !autoBattleActive;
    if (autoBattleActive) {
      autoBattleBtn.textContent = "⏹ Auto Battle Stoppen";
      autoBattleBtn.classList.add("active");
      // Start pondering for first auto-move
      // @ts-expect-error - GameState union comparison with string literal
      if (game.state !== "game_over") {
        startPondering(game, game.currentFaction);
      }
      triggerAutoMove();
    } else {
      autoBattleBtn.textContent = "🤖 Auto Battle";
      autoBattleBtn.classList.remove("active");
      clearTimeout(autoBattleTimer!);
    }
    saveSettings({ ...loadSettings(), autoBattle: autoBattleActive });
  });

  const undoBtn = document.getElementById("undo-btn") as HTMLButtonElement;
  undoBtn?.addEventListener("click", () => {
    const snap = game.undo();
    if (snap) updateUI();
  });

  const rpsToggle = document.getElementById("rps-toggle") as HTMLInputElement;
  rpsToggle?.addEventListener("change", (e: Event) => {
    game.rpsEnabled = (e.target as HTMLInputElement).checked;
    updateUI();
    saveSettings({
      ...loadSettings(),
      rpsEnabled: (e.target as HTMLInputElement).checked,
    });
  });

  const soundToggle = document.getElementById(
    "sound-toggle",
  ) as HTMLInputElement;
  soundToggle?.addEventListener("change", (e: Event) => {
    sounds.toggle((e.target as HTMLInputElement).checked);
    saveSettings({
      ...loadSettings(),
      soundEnabled: (e.target as HTMLInputElement).checked,
    });
  });

  const depthSlider = document.getElementById(
    "depth-slider",
  ) as HTMLInputElement;
  const depthLabel = document.getElementById("depth-label") as HTMLElement;
  depthSlider?.addEventListener("input", (e: Event) => {
    const depth = parseInt((e.target as HTMLInputElement).value) as
      | 1
      | 2
      | 3
      | 4;
    setAIDepth(depth);
    depthLabel.textContent = "KI: " + depthNames[depth];
    saveSettings({ ...loadSettings(), aiDepth: depth });
  });

  let currentBoardRotation = 0;
  const rotateBtn = document.getElementById("rotate-btn") as HTMLButtonElement;
  rotateBtn?.addEventListener("click", () => {
    currentBoardRotation += 120;
    renderer.setRotation(currentBoardRotation);
    saveSettings({ ...loadSettings(), boardRotation: currentBoardRotation });
  });

  const restartBtn = document.getElementById(
    "restart-btn",
  ) as HTMLButtonElement;
  restartBtn?.addEventListener("click", () => {
    const combatOverlay = document.getElementById(
      "combat-overlay",
    ) as HTMLElement;
    const promotionOverlay = document.getElementById(
      "promotion-overlay",
    ) as HTMLElement;
    combatOverlay.classList.remove("visible");
    promotionOverlay.classList.remove("visible");
    const boardGroup = document.getElementById("board-group");
    boardGroup?.querySelectorAll(".piece").forEach((el) => el.remove());
    renderer.pieceElements.clear();
    game.init(renderer.cells);
    game.clearUndoStack();
    autoBattleBookMoves = []; // Clear learning tracking
    const moveLogEl = document.getElementById("move-log") as HTMLElement;
    moveLogEl.innerHTML = "";
    for (const p of game.getAlivePieces()) renderer.renderPiece(p);
    for (const fac of [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]) {
      const el = document.getElementById(`panel-${fac}`);
      if (el) el.classList.remove("eliminated");
    }

    autoBattleActive = false;
    const autoBattleBtn = document.getElementById(
      "auto-battle-btn",
    ) as HTMLButtonElement;
    if (autoBattleBtn) {
      autoBattleBtn.textContent = "🤖 Auto Battle";
      autoBattleBtn.classList.remove("active");
    }
    clearTimeout(autoBattleTimer!);

    saveSettings({ ...loadSettings(), autoBattle: false });
    updateUI();
  });

  const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
  saveBtn?.addEventListener("click", () => {
    downloadGame(
      game,
      `trischach-${new Date().toISOString().slice(0, 10)}.tspn`,
    );
  });

  const copyBtn = document.getElementById("copy-btn") as HTMLButtonElement;
  copyBtn?.addEventListener("click", async () => {
    try {
      await copyGameToClipboard(game);
      copyBtn.textContent = "✅ Kopiert!";
      setTimeout(() => {
        copyBtn.textContent = "📋 Kopieren";
      }, 1500);
    } catch (e) {
      console.error("Copy failed:", e);
      copyBtn.textContent = "❌ Fehler";
      setTimeout(() => {
        copyBtn.textContent = "📋 Kopieren";
      }, 1500);
    }
  });

  const puzzleBtn = document.getElementById("puzzle-btn") as HTMLButtonElement;
  puzzleBtn?.addEventListener("click", () => {
    if (game.state === "game_over") return;
    showPuzzleMenu();
  });

  const loadBtn = document.getElementById("load-btn") as HTMLButtonElement;
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".tspn,text/plain";
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);

  loadBtn?.addEventListener("click", () => {
    fileInput.click();
  });

  fileInput.addEventListener("change", async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      const parsed = await loadGameFromFile(file);
      console.log("Loaded game:", parsed.headers);

      const { game: replayGame, controller: replayController } =
        reconstructGameFromTSPN(parsed, Game, renderer.cells);

      autoBattleActive = false;
      const autoBattleBtn = document.getElementById(
        "auto-battle-btn",
      ) as HTMLButtonElement;
      if (autoBattleBtn) {
        autoBattleBtn.textContent = "🤖 Auto Battle";
        autoBattleBtn.classList.remove("active");
      }
      clearTimeout(autoBattleTimer!);

      Object.assign(game, replayGame);
      game.clearUndoStack();

      window.replayController = replayController;

      const boardGroup = document.getElementById("board-group");
      boardGroup?.querySelectorAll(".piece").forEach((el) => el.remove());
      renderer.pieceElements.clear();
      for (const p of game.getAlivePieces()) renderer.renderPiece(p);

      const moveLogEl = document.getElementById("move-log") as HTMLElement;
      moveLogEl.innerHTML = "";
      for (const move of parsed.moves) {
        const entry = document.createElement("div");
        entry.className = `move-entry ${move.faction}`;
        entry.textContent = `${move.faction} ${move.san}`;
        moveLogEl.appendChild(entry);
      }

      showReplayControls();
      updateReplayUI();
      updateUI();
    } catch (err) {
      console.error("Load failed:", err);
      alert("Fehler beim Laden: " + (err as Error).message);
    }

    fileInput.value = "";
  });

  // Replay controls
  let replayPlayTimer: ReturnType<typeof setInterval> | null = null;

  function showReplayControls(): void {
    const replayControls = document.getElementById("replay-controls");
    if (replayControls) replayControls.style.display = "flex";
  }

  function hideReplayControls(): void {
    const replayControls = document.getElementById("replay-controls");
    if (replayControls) replayControls.style.display = "none";
  }

  function updateReplayUI(): void {
    const controller = window.replayController as any;
    if (!controller) return;

    const moveInfo = document.getElementById("replay-move-info") as HTMLElement;
    if (moveInfo) {
      const moveNum = controller.getCurrentMoveNumber();
      const total = controller.getTotalMoves();
      moveInfo.textContent = `Zug ${moveNum} / ${total}`;
    }

    const isAtEnd = !controller.canGoForward();
    const isAtStart = !controller.canGoBack();

    const replayFirst = document.getElementById(
      "replay-first",
    ) as HTMLButtonElement;
    const replayPrev = document.getElementById(
      "replay-prev",
    ) as HTMLButtonElement;
    const replayNext = document.getElementById(
      "replay-next",
    ) as HTMLButtonElement;
    const replayLast = document.getElementById(
      "replay-last",
    ) as HTMLButtonElement;
    const replayPlay = document.getElementById(
      "replay-play",
    ) as HTMLButtonElement;
    const replayPause = document.getElementById(
      "replay-pause",
    ) as HTMLButtonElement;

    if (replayFirst) replayFirst.disabled = isAtStart;
    if (replayPrev) replayPrev.disabled = isAtStart;
    if (replayNext) replayNext.disabled = isAtEnd;
    if (replayLast) replayLast.disabled = isAtEnd;
    if (replayPlay)
      replayPlay.style.display = isAtEnd ? "none" : "inline-block";
    if (replayPause) replayPause.style.display = "none";

    const moveEntries = document.querySelectorAll(".move-entry");
    moveEntries.forEach((entry, index) => {
      entry.classList.toggle(
        "current-move",
        index === controller.getCurrentMoveNumber() - 1,
      );
    });
  }

  function replayStep(delta: number): void {
    const controller = window.replayController;
    if (!controller) return;

    if (delta > 0) controller.next();
    else controller.previous();

    const state = controller.getCurrentState();
    if (state) applyGameState(state);

    updateReplayUI();
  }

  function replayPlay(): void {
    stopReplayPlay();
    const controller = window.replayController;
    if (!controller || !controller.canGoForward()) return;

    const replayPlay = document.getElementById(
      "replay-play",
    ) as HTMLButtonElement;
    const replayPause = document.getElementById(
      "replay-pause",
    ) as HTMLButtonElement;
    if (replayPlay) replayPlay.style.display = "none";
    if (replayPause) replayPause.style.display = "inline-block";

    const speed = parseFloat(
      (document.getElementById("replay-speed") as HTMLInputElement)?.value ||
        "1",
    );
    const delay = 1000 / speed;

    replayPlayTimer = setInterval(() => {
      const c = window.replayController;
      if (!c || !c.canGoForward()) {
        stopReplayPlay();
        return;
      }
      c.next();
      const state = c.getCurrentState();
      if (state) applyGameState(state);
      updateReplayUI();
    }, delay);
  }

  function stopReplayPlay(): void {
    if (replayPlayTimer) {
      clearInterval(replayPlayTimer);
      replayPlayTimer = null;
    }
    const replayPlay = document.getElementById(
      "replay-play",
    ) as HTMLButtonElement;
    const replayPause = document.getElementById(
      "replay-pause",
    ) as HTMLButtonElement;
    if (replayPlay) replayPlay.style.display = "inline-block";
    if (replayPause) replayPause.style.display = "none";
  }

  function applyGameState(state: any): void {
    const boardGroup = document.getElementById("board-group");
    if (boardGroup) {
      boardGroup.querySelectorAll(".piece").forEach((el) => el.remove());
    }
    renderer.pieceElements.clear();

    for (const p of state.pieces) {
      if (p.alive) {
        const piece = game.pieces.find((pc: any) => pc.id === p.id);
        if (piece) {
          Object.assign(piece, p);
          renderer.renderPiece(piece);
        }
      }
    }

    game.currentFaction = state.currentFaction;
    game.currentFactionIdx = state.currentFactionIdx;
    game.state = state.state;
    game.eliminatedFactions = new Set(state.eliminatedFactions);
    game.capturedPieces = {
      fire: (state.capturedPieces.fire || [])
        .map((id: string) => game.pieces.find((p: any) => p.id === id))
        .filter(Boolean),
      water: (state.capturedPieces.water || [])
        .map((id: string) => game.pieces.find((p: any) => p.id === id))
        .filter(Boolean),
      nature: (state.capturedPieces.nature || [])
        .map((id: string) => game.pieces.find((p: any) => p.id === id))
        .filter(Boolean),
    };

    for (const fac of [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]) {
      const el = document.getElementById(`panel-${fac}`);
      if (el && state.eliminatedFactions?.includes(fac)) {
        el.classList.add("eliminated");
      } else if (el) {
        el.classList.remove("eliminated");
      }
    }

    updateUI();
  }

  // Replay Controls Event Listeners
  const replayFirst = document.getElementById(
    "replay-first",
  ) as HTMLButtonElement;
  const replayPrev = document.getElementById(
    "replay-prev",
  ) as HTMLButtonElement;
  const replayPlayBtn = document.getElementById(
    "replay-play",
  ) as HTMLButtonElement;
  const replayPauseBtn = document.getElementById(
    "replay-pause",
  ) as HTMLButtonElement;
  const replayNext = document.getElementById(
    "replay-next",
  ) as HTMLButtonElement;
  const replayLast = document.getElementById(
    "replay-last",
  ) as HTMLButtonElement;
  const replaySpeed = document.getElementById(
    "replay-speed",
  ) as HTMLInputElement;

  replayFirst?.addEventListener("click", () => {
    const controller = window.replayController as ReplayController;
    controller.goToStart();
    applyGameState(controller.getCurrentState());
    updateReplayUI();
  });

  replayPrev?.addEventListener("click", () => {
    const controller = window.replayController as ReplayController;
    controller.previous();
    applyGameState(controller.getCurrentState());
    updateReplayUI();
  });

  replayPlayBtn?.addEventListener("click", () => {
    replayPlay();
  });

  replayPauseBtn?.addEventListener("click", () => {
    stopReplayPlay();
  });

  replayNext?.addEventListener("click", () => {
    const controller = window.replayController as ReplayController;
    controller.next();
    applyGameState(controller.getCurrentState());
    updateReplayUI();
  });

  replayLast?.addEventListener("click", () => {
    const controller = window.replayController as ReplayController;
    controller.goToEnd();
    applyGameState(controller.getCurrentState());
    updateReplayUI();
  });

  const replayExport = document.getElementById(
    "replay-export",
  ) as HTMLButtonElement;
  replayExport?.addEventListener("click", () => {
    const controller = window.replayController;
    if (!controller) return;

    try {
      const tspn = controller.exportTSPN();
      const blob = new Blob([tspn], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const moveNum = controller.getCurrentMoveNumber();
      const total = controller.getTotalMoves();
      a.download = `trischach-pos-${moveNum}-of-${total}-${new Date().toISOString().slice(0, 10)}.tspn`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
      alert("Export fehlgeschlagen: " + (err as Error).message);
    }
  });

  const replayExportFull = document.getElementById(
    "replay-export-full",
  ) as HTMLButtonElement;
  replayExportFull?.addEventListener("click", () => {
    const controller = window.replayController;
    if (!controller) return;

    try {
      // Export the full game from initial position to end
      const tspn = controller.exportTSPNFull();
      const blob = new Blob([tspn], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const total = controller.getTotalMoves();
      a.download = `trischach-full-${total}moves-${new Date().toISOString().slice(0, 10)}.tspn`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Full export failed:", err);
      alert("Export fehlgeschlagen: " + (err as Error).message);
    }
  });

  replaySpeed?.addEventListener("input", () => {
    if (replayPlayTimer) {
      replayPlay();
    }
  });

  // ─── Puzzle Mode ────────────────────────────────────────────────────

  let puzzleGame: Game | null = null;
  let puzzleRenderer: BoardRenderer | null = null;
  let puzzleBoardGroup: SVGGElement | null = null;
  let puzzleTimerInterval: ReturnType<typeof setInterval> | null = null;
  let puzzleStartTime: number = 0;

  async function showPuzzleMenu(): Promise<void> {
    puzzleOverlay.innerHTML = `
      <div class="puzzle-box">
        <div class="puzzle-header">
          <h2 class="puzzle-title">♟ Puzzle Modus</h2>
          <button class="puzzle-close-btn" id="puzzle-close-btn" title="Schließen">✕</button>
        </div>
        <div class="puzzle-info" id="puzzle-menu-info">
          <div class="puzzle-info-item"><strong>Tagespuzzle</strong></div>
          <span class="puzzle-difficulty medium" id="puzzle-daily-difficulty">Medium</span>
        </div>
        <div class="puzzle-actions">
          <button class="puzzle-btn primary" id="puzzle-daily-btn">📅 Tagespuzzle</button>
          <button class="puzzle-btn secondary" id="puzzle-generate-btn">🔄 Neu generieren</button>
          <button class="puzzle-btn secondary" id="puzzle-continue-btn" style="display: none">▶️ Fortsetzen</button>
        </div>
      </div>
    `;
    puzzleOverlay.classList.add("visible");

    document
      .getElementById("puzzle-close-btn")
      ?.addEventListener("click", () => {
        puzzleOverlay.classList.remove("visible");
      });

    document
      .getElementById("puzzle-daily-btn")
      ?.addEventListener("click", async () => {
        await loadAndShowDailyPuzzle();
      });

    document
      .getElementById("puzzle-generate-btn")
      ?.addEventListener("click", async () => {
        await generateAndShowPuzzles();
      });

    document
      .getElementById("puzzle-continue-btn")
      ?.addEventListener("click", () => {
        const state = getPuzzleState();
        if (state.currentPuzzle) {
          showPuzzleBoard(state.currentPuzzle);
        }
      });

    // Check for saved progress
    const state = getPuzzleState();
    if (state.currentPuzzle) {
      (
        document.getElementById("puzzle-continue-btn") as HTMLButtonElement
      ).style.display = "inline-block";
    }
  }

  async function loadAndShowDailyPuzzle(): Promise<void> {
    showLoading("Lade Tagespuzzle...");
    const daily = await getDailyPuzzle();
    hideLoading();
    if (daily) {
      showPuzzleBoard(daily);
    } else {
      showError("Konnte Tagespuzzle nicht laden.");
    }
  }

  async function generateAndShowPuzzles(): Promise<void> {
    showLoading("Generiere Puzzles...");
    const puzzles = await generatePuzzlesFromBook(5);
    hideLoading();
    if (puzzles.length > 0) {
      showPuzzleSelection(puzzles);
    } else {
      showError("Keine Puzzles gefunden.");
    }
  }

  function showPuzzleSelection(puzzles: Puzzle[]): void {
    puzzleOverlay.innerHTML = `
      <div class="puzzle-box">
        <div class="puzzle-header">
          <h2 class="puzzle-title">Wähle ein Puzzle</h2>
          <button class="puzzle-close-btn" id="puzzle-back-btn" title="Zurück">✕</button>
        </div>
        <div class="puzzle-solution-list" style="max-height: 400px;">
          ${puzzles
            .map(
              (p, i) => `
            <div class="puzzle-move" data-index="${i}">
              <span class="puzzle-move-number">${i + 1}.</span>
              <span class="puzzle-move-san">Matt in ${p.mateIn} (${p.difficulty})</span>
              <span class="puzzle-move-status pending">${p.faction}</span>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>
    `;

    document
      .getElementById("puzzle-back-btn")
      ?.addEventListener("click", () => {
        showPuzzleMenu();
      });

    puzzleOverlay.querySelectorAll(".puzzle-move[data-index]").forEach((el) => {
      el.addEventListener("click", () => {
        const index = parseInt(el.getAttribute("data-index")!);
        const puzzle = puzzles[index];
        if (puzzle) showPuzzleBoard(puzzle!);
      });
    });
  }

  function showPuzzleBoard(puzzle: Puzzle): void {
    // Create a new game from the puzzle position
    const testGame = new Game();
    const cells = generateBoard();
    testGame.init(cells);

    // Deserialize the puzzle position
    const gameFromFen = deserializePuzzleFEN(puzzle.fen);
    if (!gameFromFen) {
      showError("Ungültige Puzzle-Position.");
      return;
    }

    // Copy state to testGame
    Object.assign(testGame, gameFromFen);
    testGame.clearUndoStack(); // No undo in puzzle mode

    puzzleGame = testGame;
    puzzleStartTime = Date.now();

    // Create a temporary renderer for the puzzle board
    const puzzleBoardContainer = document.createElement("div");
    puzzleBoardContainer.className = "puzzle-board-container";

    puzzleOverlay.innerHTML = `
      <div class="puzzle-box">
        <div class="puzzle-header">
          <h2 class="puzzle-title">♟ Matt in ${puzzle.mateIn}</h2>
          <button class="puzzle-close-btn" id="puzzle-close-btn" title="Abbrechen">✕</button>
        </div>
        <div class="puzzle-info">
          <span class="puzzle-difficulty ${puzzle.difficulty}">${puzzle.difficulty.toUpperCase()}</span>
          <span class="puzzle-info-item">Am Zug: <strong>${FACTION_COLORS[puzzle.faction].name}</strong></span>
        </div>
        <div id="puzzle-board-wrapper" class="puzzle-board-container"></div>
        <div class="puzzle-progress">
          <div class="puzzle-progress-bar" id="puzzle-progress-bar" style="width: 0%"></div>
        </div>
        <div class="puzzle-timer" id="puzzle-timer">00:00</div>
        <div class="puzzle-solution-title">Lösungsweg</div>
        <div class="puzzle-solution-list" id="puzzle-solution-list"></div>
        <div class="puzzle-actions">
          <button class="puzzle-btn secondary" id="puzzle-hint-btn">💡 Hinweis</button>
          <button class="puzzle-btn danger" id="puzzle-giveup-btn">🏳 Aufgeben</button>
          <button class="puzzle-btn primary" id="puzzle-reset-btn" style="display: none">🔄 Neustart</button>
        </div>
      </div>
    `;
    puzzleOverlay.classList.add("visible");

    // Render the board in the wrapper
    const boardWrapper = document.getElementById("puzzle-board-wrapper")!;
    const puzzleSvg = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    puzzleSvg.id = "puzzle-board-svg";
    puzzleSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    boardWrapper.appendChild(puzzleSvg);

    puzzleRenderer = new BoardRenderer(puzzleSvg);
    puzzleRenderer.render();
    puzzleBoardGroup = puzzleRenderer.pieceElements.size
      ? puzzleSvg.querySelector("#board-group")
      : null;

    // Render pieces
    for (const p of puzzleGame.getAlivePieces()) {
      puzzleRenderer.renderPiece(p);
    }

    // Render solution list
    renderSolutionList(puzzle);

    // Start timer
    puzzleTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - puzzleStartTime) / 1000);
      const mins = Math.floor(elapsed / 60)
        .toString()
        .padStart(2, "0");
      const secs = (elapsed % 60).toString().padStart(2, "0");
      (document.getElementById("puzzle-timer") as HTMLElement).textContent =
        `${mins}:${secs}`;
    }, 1000);

    // Event listeners
    document
      .getElementById("puzzle-close-btn")
      ?.addEventListener("click", () => {
        abandonPuzzle();
        cleanupPuzzle();
        showPuzzleMenu();
      });

    document
      .getElementById("puzzle-hint-btn")
      ?.addEventListener("click", () => {
        const hint = requestHint();
        if (hint) {
          showHintToast(`Zug: ${hint.san}`);
        }
      });

    document
      .getElementById("puzzle-giveup-btn")
      ?.addEventListener("click", () => {
        showPuzzleResult(false, puzzle);
      });

    document
      .getElementById("puzzle-reset-btn")
      ?.addEventListener("click", () => {
        resetPuzzle();
        showPuzzleBoard(puzzle);
      });

    // Handle clicks on the puzzle board
    puzzleSvg.addEventListener("click", (e) =>
      handlePuzzleBoardClick(e, puzzleGame!),
    );
  }

  function renderSolutionList(puzzle: Puzzle): void {
    const listEl = document.getElementById("puzzle-solution-list")!;
    const state = getPuzzleState();

    listEl.innerHTML = puzzle.solution
      .map((move, i) => {
        let statusClass = "pending";
        let statusText = "⏳";
        if (i < state.currentMoveIndex) {
          statusClass = "correct";
          statusText = "✅";
        } else if (i === state.currentMoveIndex) {
          statusClass = "current";
          statusText = "▶️";
        }
        return `
        <div class="puzzle-move ${statusClass}">
          <span class="puzzle-move-number">${i + 1}.</span>
          <span class="puzzle-move-san">${move.san}</span>
          <span class="puzzle-move-status ${statusClass}">${statusText}</span>
        </div>
      `;
      })
      .join("");

    // Update progress bar
    const progress = (state.currentMoveIndex / puzzle.solution.length) * 100;
    (
      document.getElementById("puzzle-progress-bar") as HTMLElement
    ).style.width = `${progress}%`;
  }

  function handlePuzzleBoardClick(event: MouseEvent, pg: Game): void {
    if (!pg || getPuzzleState().isComplete) return;

    // Find clicked hex from SVG coordinates
    const svg = event.target as SVGElement;
    const boardGroup = svg.closest("#board-group") as SVGGElement;
    if (!boardGroup) return;

    // Get click coordinates relative to SVG
    const svgEl = document.getElementById(
      "puzzle-board-svg",
    ) as unknown as SVGSVGElement;
    const rect = svgEl.getBoundingClientRect();
    const clientX = event.clientX - rect.left;
    const clientY = event.clientY - rect.top;

    // Find hex under click (simplified - use renderer's hit testing)
    // For now, we'll use a simpler approach: check which piece was clicked
    const target = event.target as SVGGElement;
    const pieceEl = target.closest(".piece") as SVGGElement;
    const cellEl = target.closest(".cell") as SVGGElement;

    if (pieceEl) {
      const pieceId = pieceEl.getAttribute("data-piece-id");
      if (!pieceId) return;

      const piece = pg.getAlivePieces().find((p) => p.id === pieceId);
      if (!piece) return;

      const state = getPuzzleState();
      if (state.currentMoveIndex >= state.currentPuzzle!.solution.length)
        return;

      const expectedMove =
        state.currentPuzzle!.solution[state.currentMoveIndex]!;

      if (pieceId === expectedMove.pieceId) {
        // Correct piece selected, now wait for target click
        pg.handleCellClick(piece.pos); // Select the piece
        showSelectionHighlights(piece);
      }
    } else if (cellEl) {
      const hexKey = cellEl.getAttribute("data-hex-key");
      if (!hexKey) return;

      const parts = hexKey.split(",");
      const q = Number(parts[0]);
      const r = Number(parts[1]);
      const targetHex = new Hex(q, r);

      // Try to make the move
      const expectedMove =
        getPuzzleState().currentPuzzle!.solution[
          getPuzzleState().currentMoveIndex
        ]!;
      const result = makePuzzleMove(pg, expectedMove.pieceId, targetHex);

      if (result.correct) {
        // Move was correct
        sounds.playMove();
        const move = pg.moveHistory[pg.moveHistory.length - 1]!;
        addToLog(move);
        puzzleGame
          ?.getAlivePieces()
          .forEach((p) => puzzleRenderer?.renderPiece(p));
        renderSolutionList(getPuzzleState().currentPuzzle!);

        if (result.gameOver) {
          setTimeout(
            () => showPuzzleResult(true, getPuzzleState().currentPuzzle!),
            500,
          );
        }
      } else {
        // Wrong move
        sounds.playError();
        showPuzzleResult(false, getPuzzleState().currentPuzzle!);
      }
    }

    pg._rebuildOccupiedMap();
  }

  function showSelectionHighlights(piece: Piece): void {
    if (!puzzleGame || !puzzleRenderer) return;
    puzzleRenderer.clearHighlights();
    puzzleRenderer.clearSelection();
    puzzleRenderer.selectCell(piece.pos);
    const { moves, attacks } = puzzleGame.getLegalMoves(piece);
    puzzleRenderer.highlightCells(moves, "highlight-move");
    if (puzzleGame.rpsEnabled) {
      // We don't have rpsAttacks here, just use attacks
      puzzleRenderer.highlightCells(attacks, "highlight-attack");
    } else {
      puzzleRenderer.highlightCells(attacks, "highlight-attack");
    }
  }

  function showPuzzleResult(success: boolean, puzzle: Puzzle): void {
    if (puzzleTimerInterval) {
      clearInterval(puzzleTimerInterval);
      puzzleTimerInterval = null;
    }

    const state = getPuzzleState();
    const elapsed = Math.floor((Date.now() - puzzleStartTime) / 1000);
    const mins = Math.floor(elapsed / 60)
      .toString()
      .padStart(2, "0");
    const secs = (elapsed % 60).toString().padStart(2, "0");

    puzzleOverlay.innerHTML = `
      <div class="puzzle-box">
        <div class="puzzle-header">
          <h2 class="puzzle-title">${success ? "🎉 Gelöst!" : "😔 Gescheitert"}</h2>
          <button class="puzzle-close-btn" id="puzzle-result-close" title="Schließen">✕</button>
        </div>
        <div class="puzzle-result ${success ? "success" : "failed"}">
          <div class="puzzle-result-title">${success ? "Matt gesetzt!" : "Falscher Zug"}</div>
          <div class="puzzle-result-stats">
            <span>Zeit: <strong>${mins}:${secs}</strong></span>
            <span>Züge: <strong>${state.currentMoveIndex}/${puzzle.solution.length}</strong></span>
            ${success && state.hintUsed ? '<span style="color: var(--water)">Hinweis genutzt</span>' : ""}
            ${!success && state.expectedMove ? `<span>Richtig: <strong>${state.expectedMove.san}</strong></span>` : ""}
          </div>
        </div>
        <div class="puzzle-actions">
          <button class="puzzle-btn primary" id="puzzle-again-btn">🔄 Nochmal</button>
          <button class="puzzle-btn secondary" id="puzzle-menu-btn">📋 Menü</button>
        </div>
      </div>
    `;

    document
      .getElementById("puzzle-result-close")
      ?.addEventListener("click", () => {
        cleanupPuzzle();
        showPuzzleMenu();
      });

    document
      .getElementById("puzzle-again-btn")
      ?.addEventListener("click", () => {
        resetPuzzle();
        showPuzzleBoard(puzzle);
      });

    document
      .getElementById("puzzle-menu-btn")
      ?.addEventListener("click", () => {
        cleanupPuzzle();
        showPuzzleMenu();
      });
  }

  function cleanupPuzzle(): void {
    if (puzzleTimerInterval) {
      clearInterval(puzzleTimerInterval);
      puzzleTimerInterval = null;
    }
    puzzleGame = null;
    puzzleRenderer = null;
    puzzleBoardGroup = null;
  }

  function deserializePuzzleFEN(fen: string): Game | null {
    try {
      const [piecesStr, factionIdxStr] = fen.split("#");
      const factionIdx = parseInt(factionIdxStr ?? "0", 10);

      const game = new Game();
      const cells = generateBoard();
      game.init(cells);

      for (const p of game.pieces) p.alive = false;

      if (piecesStr) {
        const pieceEntries = piecesStr.split("|");
        for (const entry of pieceEntries) {
          if (!entry) continue;
          const factionChar = entry[0];
          const typeChar = entry[1];
          const coords = entry.slice(2).split(",");
          const q = Number(coords[0]);
          const r = Number(coords[1]);

          const faction =
            factionChar === "F"
              ? "fire"
              : factionChar === "W"
                ? "water"
                : "nature";
          const piece = game.pieces.find(
            (p) => p.faction === faction && p.pos.q === q && p.pos.r === r,
          );
          if (piece) piece.alive = true;
        }
      }

      game.currentFactionIdx = factionIdx % 3;
      const factions = ["fire", "water", "nature"] as const;
      // @ts-expect-error - index is always valid (0, 1, 2)
      game.currentFaction = factions[game.currentFactionIdx];
      game._rebuildOccupiedMap();

      return game;
    } catch {
      return null;
    }
  }

  function showLoading(message: string): void {
    puzzleOverlay.innerHTML = `
      <div class="puzzle-box">
        <div class="puzzle-title">${message}</div>
        <div style="margin-top: 1rem; color: var(--water);">⏳</div>
      </div>
    `;
    puzzleOverlay.classList.add("visible");
  }

  function hideLoading(): void {
    // Will be replaced by next screen
  }

  function showError(message: string): void {
    puzzleOverlay.innerHTML = `
      <div class="puzzle-box">
        <div class="puzzle-header">
          <h2 class="puzzle-title" style="color: var(--fire)">⚠️ Fehler</h2>
          <button class="puzzle-close-btn" id="puzzle-error-close">✕</button>
        </div>
        <p style="color: var(--text-dim); margin: 1rem 0;">${message}</p>
        <button class="puzzle-btn primary" id="puzzle-error-retry">OK</button>
      </div>
    `;
    document
      .getElementById("puzzle-error-close")
      ?.addEventListener("click", () => showPuzzleMenu());
    document
      .getElementById("puzzle-error-retry")
      ?.addEventListener("click", () => showPuzzleMenu());
  }

  function showHintToast(message: string): void {
    const existing = document.getElementById("puzzle-hint-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "puzzle-hint-toast";
    toast.className = "puzzle-hint-toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("visible"));

    setTimeout(() => {
      toast.classList.remove("visible");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Personality Selector
  const personalitySelect = document.getElementById(
    "personality-select",
  ) as HTMLSelectElement;
  personalitySelect?.addEventListener("change", (e: Event) => {
    const personality = (e.target as HTMLSelectElement).value as
      | "balanced"
      | "aggressive"
      | "defensive"
      | "tactical";
    setAIPersonality(personality);
    if (aiWorker && workerReady) {
      aiWorker.postMessage({ type: "setPersonality", depth: personality });
    }
    saveSettings({ ...loadSettings(), aiPersonality: personality });
  });

  // Settings Modal
  settingsBtn?.addEventListener("click", () => {
    settingsOverlay?.classList.add("visible");
    // Load current settings into UI
    const settings = loadSettings();
    const autoQueenCheckbox = document.getElementById(
      "auto-queen",
    ) as HTMLInputElement;
    if (autoQueenCheckbox)
      autoQueenCheckbox.checked = settings.autoQueen ?? false;
    const abGames = document.getElementById("ab-games") as HTMLInputElement;
    const abGamesValue = document.getElementById(
      "ab-games-value",
    ) as HTMLElement;
    if (abGames) {
      abGames.value = String(settings.abGames ?? 100);
      if (abGamesValue)
        abGamesValue.textContent = String(settings.abGames ?? 100);
    }
    const abDepth = document.getElementById("ab-depth") as HTMLInputElement;
    const abDepthValue = document.getElementById(
      "ab-depth-value",
    ) as HTMLElement;
    if (abDepth) {
      abDepth.value = String(settings.abDepth ?? 4);
      if (abDepthValue)
        abDepthValue.textContent = String(settings.abDepth ?? 4);
    }
    const abMaxMoves = document.getElementById(
      "ab-max-moves",
    ) as HTMLInputElement;
    const abMaxMovesValue = document.getElementById(
      "ab-max-moves-value",
    ) as HTMLElement;
    if (abMaxMoves) {
      abMaxMoves.value = String(settings.abMaxMoves ?? 300);
      if (abMaxMovesValue)
        abMaxMovesValue.textContent = String(settings.abMaxMoves ?? 300);
    }
    // Personality checkboxes
    const personalities = settings.abPersonalities ?? [
      "balanced",
      "aggressive",
      "defensive",
      "tactical",
    ];
    document
      .querySelectorAll(".personality-checkboxes input[type=checkbox]")
      .forEach((cb) => {
        const checkbox = cb as HTMLInputElement;
        checkbox.checked = personalities.includes(checkbox.value);
      });
  });

  settingsCloseBtn?.addEventListener("click", () => {
    settingsOverlay?.classList.remove("visible");
  });

  settingsOverlay?.addEventListener("click", (e: Event) => {
    if (e.target === settingsOverlay) {
      settingsOverlay.classList.remove("visible");
    }
  });

  // Tab switching
  settingsTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const targetTab = tab.getAttribute("data-tab");
      if (!targetTab) return;
      settingsTabs.forEach((t) => t.classList.remove("active"));
      settingsPanels.forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      const targetPanel = document.getElementById(`panel-${targetTab}`);
      targetPanel?.classList.add("active");
    });
  });

  // Auto-Queen checkbox
  const autoQueenCheckbox = document.getElementById(
    "auto-queen",
  ) as HTMLInputElement;
  autoQueenCheckbox?.addEventListener("change", (e: Event) => {
    saveSettings({
      ...loadSettings(),
      autoQueen: (e.target as HTMLInputElement).checked,
    });
  });

  // Slider value displays
  const abGames = document.getElementById("ab-games") as HTMLInputElement;
  const abGamesValue = document.getElementById("ab-games-value") as HTMLElement;
  abGames?.addEventListener("input", (e: Event) => {
    const val = (e.target as HTMLInputElement).value;
    if (abGamesValue) abGamesValue.textContent = val;
    saveSettings({ ...loadSettings(), abGames: parseInt(val) });
  });

  const abDepth = document.getElementById("ab-depth") as HTMLInputElement;
  const abDepthValue = document.getElementById("ab-depth-value") as HTMLElement;
  abDepth?.addEventListener("input", (e: Event) => {
    const val = (e.target as HTMLInputElement).value;
    if (abDepthValue) abDepthValue.textContent = val;
    saveSettings({ ...loadSettings(), abDepth: parseInt(val) });
  });

  const abMaxMoves = document.getElementById(
    "ab-max-moves",
  ) as HTMLInputElement;
  const abMaxMovesValue = document.getElementById(
    "ab-max-moves-value",
  ) as HTMLElement;
  abMaxMoves?.addEventListener("input", (e: Event) => {
    const val = (e.target as HTMLInputElement).value;
    if (abMaxMovesValue) abMaxMovesValue.textContent = val;
    saveSettings({ ...loadSettings(), abMaxMoves: parseInt(val) });
  });

  // Personality checkboxes
  document
    .querySelectorAll(".personality-checkboxes input[type=checkbox]")
    .forEach((cb) => {
      cb.addEventListener("change", () => {
        const selected = Array.from(
          document.querySelectorAll(
            ".personality-checkboxes input[type=checkbox]:checked",
          ),
        ).map((c) => (c as HTMLInputElement).value);
        saveSettings({ ...loadSettings(), abPersonalities: selected });
      });
    });

  // Global keyboard shortcuts (when not in input/select)
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    switch (e.key.toLowerCase()) {
      case "d":
        toggleDarkMode();
        break;
      case "?":
        showHintToast(
          "Shortcuts: ←/→ Nav, Space Play/Pause, F Flip, D Dark, C Copy, ? Help",
        );
        break;
    }
  });

  // Run Auto-Battle Learning button
  const runAbBtn = document.getElementById(
    "run-auto-battle-learning",
  ) as HTMLButtonElement;
  const resumeAbBtn = document.getElementById(
    "resume-auto-battle-learning",
  ) as HTMLButtonElement;
  const abProgress = document.getElementById("ab-progress") as HTMLElement;
  const abProgressFill = document.getElementById(
    "ab-progress-fill",
  ) as HTMLElement;
  const abProgressText = document.getElementById(
    "ab-progress-text",
  ) as HTMLElement;
  const abResult = document.getElementById("ab-result") as HTMLElement;

  // Auto-Battle Learning Resume State
  const LEARN_STATE_KEY = "trischach-auto-battle-learn-state";
  interface LearnState {
    games: number;
    depth: number;
    maxMoves: number;
    personalities: string[];
    completedGames: number;
    stats: { fire: number; water: number; nature: number; draws: number };
    currentGameIdx: number;
    personalitiesOrder: string[];
    isRunning: boolean;
  }

  function saveLearnState(state: LearnState): void {
    try {
      localStorage.setItem(LEARN_STATE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Failed to save learn state:", e);
    }
  }

  function loadLearnState(): LearnState | null {
    try {
      const stored = localStorage.getItem(LEARN_STATE_KEY);
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.warn("Failed to load learn state:", e);
    }
    return null;
  }

  function clearLearnState(): void {
    try {
      localStorage.removeItem(LEARN_STATE_KEY);
    } catch (e) {
      console.warn("Failed to clear learn state:", e);
    }
  }

  // Check for existing learn state on startup
  const savedState = loadLearnState();
  if (
    savedState &&
    savedState.isRunning &&
    savedState.completedGames < savedState.games
  ) {
    if (resumeAbBtn) resumeAbBtn.style.display = "inline-block";
    if (runAbBtn) runAbBtn.style.display = "none";
  }

  runAbBtn?.addEventListener("click", async () => {
    const settings = loadSettings();
    const games = settings.abGames ?? 100;
    const depth = settings.abDepth ?? 4;
    const maxMoves = settings.abMaxMoves ?? 300;
    const personalities = (settings.abPersonalities ?? [
      "balanced",
      "aggressive",
      "defensive",
      "tactical",
    ]) as string[];

    if (personalities.length === 0) {
      showHintToast("⚠️ Bitte mindestens eine Persönlichkeit wählen!");
      return;
    }

    // Clear any existing state at start
    clearLearnState();

    // Create consistent personality order for this run
    const personalitiesOrder = [] as string[];
    for (let i = 0; i < games; i++) {
      const personality = personalities[i % personalities.length]!;
      personalitiesOrder.push(personality);
    }

    // Show progress
    if (runAbBtn) runAbBtn.disabled = true;
    if (abProgress) abProgress.style.display = "block";
    if (abProgressFill) abProgressFill.style.width = "0%";
    if (abProgressText) abProgressText.textContent = "Initialisiere...";
    if (abResult) {
      abResult.style.display = "none";
      abResult.textContent = "";
    }

    try {
      const { calculateBestMove, setAIDepth, setAIPersonality } =
        await import("./ai-core.ts");
      const { Game } = await import("./game.ts");
      const { generateBoard } = await import("./board.ts");
      const { learnFromGame, getLearnedData } =
        await import("./opening-book.ts");

      setAIDepth(depth);

      const stats = { fire: 0, water: 0, nature: 0, draws: 0 };
      let totalGames = 0;

      // Helper to play one game
      function playGame(gameIdx: number): Promise<void> {
        return new Promise((resolve) => {
          const game = new Game();
          const cells = generateBoard();
          game.init(cells);
          game.rpsEnabled = true;

          const personality = (personalitiesOrder[
            gameIdx % personalitiesOrder.length
          ] ?? "balanced") as
            | "balanced"
            | "aggressive"
            | "defensive"
            | "tactical";
          setAIPersonality(personality);

          const gameHistory: Array<{
            hash: string;
            faction: string;
            move: { pieceId: string; targetQ: number; targetR: number };
          }> = [];
          let moveCount = 0;

          function makeMove() {
            if (game.state === "game_over" || moveCount >= maxMoves) {
              // Learn from this game
              let winnerFaction: "fire" | "water" | "nature" | null = null;
              if (game.state === "game_over") {
                const alive = game.pieces.filter((p: any) => p.alive);
                if (alive.length === 1) {
                  const winner = alive[0];
                  if (winner) {
                    winnerFaction = winner.faction as
                      | "fire"
                      | "water"
                      | "nature";
                    stats[winnerFaction]++;
                  } else {
                    stats.draws++;
                  }
                } else {
                  stats.draws++;
                }
              } else {
                stats.draws++;
              }

              if (gameHistory.length > 0) {
                learnFromGame(gameHistory, winnerFaction);
              }

              totalGames++;
              const pct = Math.round((totalGames / games) * 100);
              if (abProgressFill) abProgressFill.style.width = `${pct}%`;
              if (abProgressText)
                abProgressText.textContent = `Spiel ${totalGames} / ${games} (${pct}%)`;

              // Save state after each game for resume capability
              const state: LearnState = {
                games,
                depth,
                maxMoves,
                personalities,
                completedGames: totalGames,
                stats,
                currentGameIdx: gameIdx,
                personalitiesOrder,
                isRunning: true,
              };
              saveLearnState(state);

              resolve();
              return;
            }

            const action = calculateBestMove(game, game.currentFaction);
            if (!action) {
              resolve();
              return;
            }

            if (moveCount < 30) {
              const hash = boardHash(game);
              gameHistory.push({
                hash,
                faction: game.currentFaction,
                move: {
                  pieceId: action.piece.id,
                  targetQ: action.target.q,
                  targetR: action.target.r,
                },
              });
            }

            const selResult = game.handleCellClick(action.piece.pos);
            if (selResult?.action === "select") {
              const result = game.handleCellClick(action.target);
              if (result?.promotion && game.pendingPromotion) {
                game.completePromotion("queen");
              }
            }

            moveCount++;
            setTimeout(makeMove, 0);
          }

          makeMove();
        });
      }

      function boardHash(g: any): string {
        const pieces = g.pieces
          .filter((p: any) => p.alive)
          .map((p: any) => `${p.faction[0]}${p.type[0]}${p.pos.q},${p.pos.r}`)
          .sort()
          .join("|");
        return `${pieces}#${g.currentFactionIdx}`;
      }

      // Run games sequentially with small batches for UI responsiveness
      for (let i = 0; i < games; i++) {
        await playGame(i);
      }

      // Save learned data
      const learnedData = getLearnedData();
      const saveData = {
        version: 1,
        updated: new Date().toISOString(),
        positions: learnedData,
      };
      localStorage.setItem(
        "trischach-opening-book-learned",
        JSON.stringify(saveData),
      );

      clearLearnState();

      // Also try to update the compiled book (optional, requires reload)
      // For now, just show success
      if (abProgress) abProgress.style.display = "none";
      if (abResult) {
        abResult.style.display = "block";
        abResult.textContent =
          `✅ Fertig! ${games} Spiele gespielt.\\n` +
          `🔥 Feuer: ${stats.fire} | 🌊 Wasser: ${stats.water} | 🌿 Natur: ${stats.nature} | 🤝 Unentschieden: ${stats.draws}\\n` +
          `📚 Gelernte Positionen: ${Object.keys(learnedData).length}\\n` +
          `💾 In localStorage gespeichert. Beim nächsten Spielstart aktiv.`;
      }
      showHintToast(`✅ Auto-Battle Learning abgeschlossen (${games} Spiele)`);
    } catch (err) {
      console.error("Auto-Battle Learning failed:", err);
      if (abProgress) abProgress.style.display = "none";
      if (abResult) {
        abResult.style.display = "block";
        abResult.textContent = `❌ Fehler: ${err instanceof Error ? err.message : String(err)}`;
      }
      showHintToast("❌ Auto-Battle Learning fehlgeschlagen");
      clearLearnState();
    } finally {
      if (runAbBtn) runAbBtn.disabled = false;
    }
  });

  // Resume Auto-Battle Learning button
  resumeAbBtn?.addEventListener("click", async () => {
    const savedState = loadLearnState();
    if (
      !savedState ||
      !savedState.isRunning ||
      savedState.completedGames >= savedState.games
    ) {
      showHintToast("⚠️ Kein State zum Fortsetzen gefunden");
      return;
    }

    const settings = loadSettings();
    const games = savedState.games;
    const depth = savedState.depth;
    const maxMoves = savedState.maxMoves;
    const personalities = savedState.personalities;
    const personalitiesOrder = savedState.personalitiesOrder;
    const stats = savedState.stats;
    let totalGames = savedState.completedGames;

    if (personalities.length === 0) {
      showHintToast("⚠️ Keine Persönlichkeiten konfiguriert!");
      return;
    }

    // Show progress
    if (resumeAbBtn) resumeAbBtn.disabled = true;
    if (runAbBtn) runAbBtn.style.display = "none";
    if (resumeAbBtn) resumeAbBtn.style.display = "none";
    if (abProgress) abProgress.style.display = "block";
    if (abProgressFill)
      abProgressFill.style.width = `${Math.round((totalGames / games) * 100)}%`;
    if (abProgressText)
      abProgressText.textContent = `Spiel ${totalGames} / ${games} (${Math.round((totalGames / games) * 100)}%)`;
    if (abResult) {
      abResult.style.display = "none";
      abResult.textContent = "";
    }

    try {
      const { calculateBestMove, setAIDepth, setAIPersonality } =
        await import("./ai-core.ts");
      const { Game } = await import("./game.ts");
      const { generateBoard } = await import("./board.ts");
      const { learnFromGame, getLearnedData } =
        await import("./opening-book.ts");

      setAIDepth(depth);

      // Helper to play one game
      function playGame(gameIdx: number): Promise<void> {
        return new Promise((resolve) => {
          const game = new Game();
          const cells = generateBoard();
          game.init(cells);
          game.rpsEnabled = true;

          const personality = (personalitiesOrder[
            gameIdx % personalitiesOrder.length
          ] ?? "balanced") as
            | "balanced"
            | "aggressive"
            | "defensive"
            | "tactical";
          setAIPersonality(personality);

          const gameHistory: Array<{
            hash: string;
            faction: string;
            move: { pieceId: string; targetQ: number; targetR: number };
          }> = [];
          let moveCount = 0;

          function makeMove() {
            if (game.state === "game_over" || moveCount >= maxMoves) {
              // Learn from this game
              let winnerFaction: "fire" | "water" | "nature" | null = null;
              if (game.state === "game_over") {
                const alive = game.pieces.filter((p: any) => p.alive);
                if (alive.length === 1) {
                  const winner = alive[0];
                  if (winner) {
                    winnerFaction = winner.faction as
                      | "fire"
                      | "water"
                      | "nature";
                    stats[winnerFaction]++;
                  } else {
                    stats.draws++;
                  }
                } else {
                  stats.draws++;
                }
              } else {
                stats.draws++;
              }

              if (gameHistory.length > 0) {
                learnFromGame(gameHistory, winnerFaction);
              }

              totalGames++;
              const pct = Math.round((totalGames / games) * 100);
              if (abProgressFill) abProgressFill.style.width = `${pct}%`;
              if (abProgressText)
                abProgressText.textContent = `Spiel ${totalGames} / ${games} (${pct}%)`;

              // Save state after each game
              const state: LearnState = {
                games,
                depth,
                maxMoves,
                personalities,
                completedGames: totalGames,
                stats,
                currentGameIdx: gameIdx,
                personalitiesOrder,
                isRunning: true,
              };
              saveLearnState(state);

              resolve();
              return;
            }

            const action = calculateBestMove(game, game.currentFaction);
            if (!action) {
              resolve();
              return;
            }

            if (moveCount < 30) {
              const hash = boardHash(game);
              gameHistory.push({
                hash,
                faction: game.currentFaction,
                move: {
                  pieceId: action.piece.id,
                  targetQ: action.target.q,
                  targetR: action.target.r,
                },
              });
            }

            const selResult = game.handleCellClick(action.piece.pos);
            if (selResult?.action === "select") {
              const result = game.handleCellClick(action.target);
              if (result?.promotion && game.pendingPromotion) {
                game.completePromotion("queen");
              }
            }

            moveCount++;
            setTimeout(makeMove, 0);
          }

          makeMove();
        });
      }

      function boardHash(g: any): string {
        const pieces = g.pieces
          .filter((p: any) => p.alive)
          .map((p: any) => `${p.faction[0]}${p.type[0]}${p.pos.q},${p.pos.r}`)
          .sort()
          .join("|");
        return `${pieces}#${g.currentFactionIdx}`;
      }

      // Run remaining games
      for (let i = totalGames; i < games; i++) {
        await playGame(i);
      }

      // Save learned data
      const learnedData = getLearnedData();
      const saveData = {
        version: 1,
        updated: new Date().toISOString(),
        positions: learnedData,
      };
      localStorage.setItem(
        "trischach-opening-book-learned",
        JSON.stringify(saveData),
      );

      clearLearnState();

      if (abProgress) abProgress.style.display = "none";
      if (abResult) {
        abResult.style.display = "block";
        abResult.textContent =
          `✅ Fortgesetzt & abgeschlossen! ${games} Spiele insgesamt.\\n` +
          `🔥 Feuer: ${stats.fire} | 🌊 Wasser: ${stats.water} | 🌿 Natur: ${stats.nature} | 🤝 Unentschieden: ${stats.draws}\\n` +
          `📚 Gelernte Positionen: ${Object.keys(learnedData).length}\\n` +
          `💾 In localStorage gespeichert. Beim nächsten Spielstart aktiv.`;
      }
      showHintToast(
        `✅ Auto-Battle Learning fortgesetzt & abgeschlossen (${games} Spiele)`,
      );

      if (resumeAbBtn) resumeAbBtn.style.display = "none";
      if (runAbBtn) runAbBtn.style.display = "inline-block";
    } catch (err) {
      console.error("Auto-Battle Learning resume failed:", err);
      if (abProgress) abProgress.style.display = "none";
      if (abResult) {
        abResult.style.display = "block";
        abResult.textContent = `❌ Fehler: ${err instanceof Error ? err.message : String(err)}`;
      }
      showHintToast("❌ Auto-Battle Learning Fortsetzen fehlgeschlagen");
    } finally {
      if (resumeAbBtn) resumeAbBtn.disabled = false;
    }
  });

  // Opening Book Tab Logic
  const obRefresh = document.getElementById("ob-refresh") as HTMLButtonElement;
  const obExportLearned = document.getElementById(
    "ob-export-learned",
  ) as HTMLButtonElement;
  const obResetLearned = document.getElementById(
    "ob-reset-learned",
  ) as HTMLButtonElement;
  const obPositions = document.getElementById("ob-positions") as HTMLElement;
  const obVariations = document.getElementById("ob-variations") as HTMLElement;
  const obMaxDepth = document.getElementById("ob-max-depth") as HTMLElement;
  const obLearned = document.getElementById("ob-learned") as HTMLElement;
  const obCompiled = document.getElementById("ob-compiled") as HTMLElement;
  const obUpdated = document.getElementById("ob-updated") as HTMLElement;
  // Load opening book stats
  async function loadOpeningBookStats() {
    try {
      // Load compiled book info
      const module = await import("../opening-book.compiled.json");
      const data = module.default;

      if (data && data.metadata && data.book) {
        if (obPositions)
          obPositions.textContent = String(
            data.metadata.stats?.totalPositions ||
              Object.keys(data.book).length,
          );
        if (obVariations)
          obVariations.textContent = String(
            data.metadata.stats?.totalVariations || "\u2013",
          );
        if (obMaxDepth)
          obMaxDepth.textContent = String(
            data.metadata.stats?.maxDepth || "\u2013",
          );
        if (obCompiled)
          obCompiled.textContent = data.metadata.compiled
            ? new Date(data.metadata.compiled).toLocaleString("de-DE")
            : "\u2013";
      }

      // Load learned data from localStorage
      const learnedStored = localStorage.getItem(
        "trischach-opening-book-learned",
      );
      if (learnedStored) {
        try {
          const learnedData = JSON.parse(learnedStored);
          if (learnedData && learnedData.positions) {
            if (obLearned)
              obLearned.textContent = String(
                Object.keys(learnedData.positions).length,
              );
            if (obUpdated)
              obUpdated.textContent = learnedData.updated
                ? new Date(learnedData.updated).toLocaleString("de-DE")
                : "\u2013";
          }
        } catch {
          if (obLearned) obLearned.textContent = "0";
        }
      } else {
        if (obLearned) obLearned.textContent = "0";
        if (obUpdated) obUpdated.textContent = "\u2013";
      }
    } catch (err) {
      console.error("Failed to load opening book stats:", err);
      if (obPositions) obPositions.textContent = "Fehler";
      if (obVariations) obVariations.textContent = "Fehler";
      if (obMaxDepth) obMaxDepth.textContent = "Fehler";
      if (obLearned) obLearned.textContent = "Fehler";
      if (obCompiled) obCompiled.textContent = "Fehler";
      if (obUpdated) obUpdated.textContent = "Fehler";
    }
  }

  // Refresh button
  obRefresh?.addEventListener("click", async () => {
    showHintToast("🔄 Lade Opening Book Statistiken...");
    await loadOpeningBookStats();
    showHintToast("✅ Statistiken aktualisiert");
  });

  // Export learned data
  obExportLearned?.addEventListener("click", () => {
    const learnedStored = localStorage.getItem(
      "trischach-opening-book-learned",
    );
    if (!learnedStored) {
      showHintToast("⚠️ Keine gelernten Daten vorhanden");
      return;
    }
    try {
      const blob = new Blob([learnedStored], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trischach-learned-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showHintToast("📥 Gelernte Daten exportiert");
    } catch (err) {
      console.error("Export failed:", err);
      showHintToast("❌ Export fehlgeschlagen");
    }
  });

  // Reset learned data
  obResetLearned?.addEventListener("click", () => {
    if (
      !confirm(
        "⚠️ Alle gelernten Opening Book Daten wirklich löschen?\nDies kann nicht rückgängig gemacht werden.",
      )
    ) {
      return;
    }
    localStorage.removeItem("trischach-opening-book-learned");
    if (obLearned) obLearned.textContent = "0";
    if (obUpdated) obUpdated.textContent = "–";
    showHintToast("🗑️ Learning zurückgesetzt");
  });

  // Initial load when Opening Book tab is opened
  // We'll use a mutation observer or just load on tab click
  const obTab = document.querySelector(
    '.settings-tab[data-tab="opening-book"]',
  ) as HTMLButtonElement;
  obTab?.addEventListener("click", () => {
    loadOpeningBookStats();
  });

  // Dark Mode Toggle
  function loadDarkModePreference(): void {
    const saved = localStorage.getItem("trischach-dark-mode");
    if (saved === "light") {
      document.documentElement.setAttribute("data-theme", "light");
      darkModeBtn?.classList.add("active");
    } else {
      document.documentElement.removeAttribute("data-theme");
      darkModeBtn?.classList.remove("active");
    }
  }

  function toggleDarkMode(): void {
    const isLight =
      document.documentElement.getAttribute("data-theme") === "light";
    if (isLight) {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("trischach-dark-mode", "dark");
      darkModeBtn?.classList.remove("active");
    } else {
      document.documentElement.setAttribute("data-theme", "light");
      localStorage.setItem("trischach-dark-mode", "light");
      darkModeBtn?.classList.add("active");
    }
  }

  darkModeBtn?.addEventListener("click", () => {
    toggleDarkMode();
  });

  // Load dark mode preference on startup
  loadDarkModePreference();

  // We can also just load once when initEventListeners runs
  loadOpeningBookStats();
}

// ─── Start ──────────────────────────────────────────────────────────

function initApp(): void {
  initEventListeners();
  init();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

export { game, renderer, triggerAutoMove };
