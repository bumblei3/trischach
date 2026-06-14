/**
 * TriSchach Main Entry Point - TypeScript
 * Main application logic, UI handling, AI worker management, replay system
 */

// @ts-nocheck - Temporary: Disable type checking during migration from JS

import {
  BoardRenderer,
  FACTION_COLORS,
  FACTION,
  generateBoard,
} from "./board.ts";
import { Game, GAME_STATE, PROMOTION_CHOICES } from "./game.ts";
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
}

const DEFAULT_SETTINGS: GameSettings = {
  rpsEnabled: true,
  soundEnabled: true,
  aiDepth: 3,
  boardRotation: 0,
  autoBattle: false,
  aiPersonality: "balanced",
  autoQueen: false,
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

const svg = document.getElementById("board-svg") as SVGSVGElement;
const statusEl = document.getElementById("status") as HTMLElement;
const turnEl = document.getElementById("turn-indicator") as HTMLElement;
const rpsInfoEl = document.getElementById("rps-info") as HTMLElement;
const combatOverlay = document.getElementById("combat-overlay") as HTMLElement;
const promotionOverlay = document.getElementById(
  "promotion-overlay",
) as HTMLElement;
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
    capturedPieces: game.capturedPieces,
    _halfmoveClock: game._halfmoveClock || 0,
  };
}

// ─── Global State ───────────────────────────────────────────────────

let autoBattleActive = false;
let autoBattleTimer: ReturnType<typeof setTimeout> | null = null;
let currentBoardRotation = 0;

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
  game._undoStack = [];
  buildOpeningBook(Game);
  initAIWorker();
  const settings = loadSettings();
  applySettings(settings);

  for (const [key, cell] of renderer.hexElements) {
    const c = game.boardCells.get(key);
    if (c) cell.polygon.setAttribute("title", `Coord: ${c.hex.q},${c.hex.r}`);
  }

  for (const p of game.getAlivePieces()) renderer.renderPiece(p);
  updateUI();
}

// ─── Depth Names ────────────────────────────────────────────────────

const depthNames: Record<number, string> = {
  1: "Leicht",
  2: "Mittel",
  3: "Schwer",
  4: "Extrem",
};

// ─── UI Updates ─────────────────────────────────────────────────────

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
  const shifted = [
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

function addToLog(result: {
  piece: { faction: string; symbol: string };
  notation: string;
}): void {
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
  const result = game.handleCellClick(hex);
  if (!result) return;

  renderer.clearHighlights();
  renderer.clearSelection();

  if (result.action === "select") {
    sounds.playSelect();
    renderer.selectCell(hex);
    renderer.highlightCells(result.moves, "highlight-move");
    if (game.rpsEnabled && result.rpsAttacks) {
      renderer.highlightCells(
        result.rpsAttacks.advantage,
        "highlight-attack-advantage",
      );
      renderer.highlightCells(
        result.rpsAttacks.disadvantage,
        "highlight-attack-disadvantage",
      );
      renderer.highlightCells(result.rpsAttacks.neutral, "highlight-attack");
    } else {
      renderer.highlightCells(result.attacks, "highlight-attack");
    }
  } else if (result.action === "deselect") {
    // nothing
  } else if (result.action === "move") {
    sounds.playMove();
    addToLog(result);
    renderer.renderPiece(result.piece);

    // Start pondering for AI after human move
    if (game.state !== GAME_STATE.GAME_OVER) {
      startPondering(game, game.currentFaction);
    }

    if (result.promotion) {
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

let contextMenuPiece: {
  id: string;
  type: string;
  faction: string;
  pos: { q: number; r: number };
  symbol: string;
} | null = null;

renderer.onPieceLongPress = (
  piece: {
    id: string;
    type: string;
    faction: string;
    pos: { q: number; r: number };
    symbol: string;
  },
  position: { clientX: number; clientY: number },
) => {
  if (game.state === GAME_STATE.GAME_OVER) return;
  if (piece.faction !== game.currentFaction) return;

  contextMenuPiece = piece;
  showContextMenu(piece, position);
};

function showContextMenu(
  piece: {
    id: string;
    type: string;
    faction: string;
    pos: { q: number; r: number };
    symbol: string;
  },
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
      handleContextMenuAction(btn.dataset.action, piece);
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
    pos: { q: number; r: number };
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
        renderer.highlightCells(selectResult.moves, "highlight-move");
        if (game.rpsEnabled && selectResult.rpsAttacks) {
          renderer.highlightCells(
            selectResult.rpsAttacks.advantage,
            "highlight-attack-advantage",
          );
          renderer.highlightCells(
            selectResult.rpsAttacks.disadvantage,
            "highlight-attack-disadvantage",
          );
          renderer.highlightCells(
            selectResult.rpsAttacks.neutral,
            "highlight-attack",
          );
        } else {
          renderer.highlightCells(selectResult.attacks, "highlight-attack");
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
  clearTimeout(autoBattleTimer);
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
      game.handleCellClick(piece.pos);
      const { Hex } = await import("./hex.ts");
      const target = new Hex(action.targetQ, action.targetR);
      const result = game.handleCellClick(target);

      renderer.clearHighlights();
      renderer.clearSelection();

      if (result && result.action === "move") {
        sounds.playMove();
        addToLog(result);
        renderer.renderPiece(result.piece);
        if (result.promotion) {
          const promoResult = game.completePromotion("queen");
          if (promoResult) {
            renderer.removePiece(result.piece.id);
            renderer.renderPiece(result.piece);
            addToLog(promoResult);
          }
          updateUI();

          // Start pondering for next AI move
          if (game.state !== "game_over") {
            startPondering(game, game.currentFaction);
          }
          triggerAutoMove();
        } else {
          updateUI();

          // Start pondering for next AI move
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

function showCombat(result: {
  piece: { faction: string; symbol: string };
  defender: { faction: string; symbol: string };
  rpsResult?: string;
  elimination?: string;
  checkmate?: string;
  stalemate?: string;
  inCheck?: boolean;
  gameOver?: boolean;
  winner_faction?: string | null;
}): void {
  const combatOverlay = document.getElementById(
    "combat-overlay",
  ) as HTMLElement;
  const attColor = FACTION_COLORS[result.piece.faction];
  const defColor = FACTION_COLORS[result.defender.faction];
  const rps = result.rpsResult;

  sounds.playCombat();

  combatOverlay.innerHTML = `
    <div class="combat-box">
      <div class="combat-fighters">
        <div class="fighter" style="color:${attColor.primary}">
          <span class="fighter-symbol">${result.piece.symbol}</span>
          <span class="fighter-name">${attColor.name}</span>
        </div>
        <div class="combat-vs">${rps === "advantage" ? ">" : "<"}</div>
        <div class="fighter" style="color:${defColor.primary}">
          <span class="fighter-symbol">${result.defender.symbol}</span>
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
    } else if (autoBattleActive) {
      triggerAutoMove();
    }
  }, 2200);
}

// ─── Promotion Overlay ──────────────────────────────────────────────

function showPromotion(piece: {
  id: string;
  type: string;
  faction: string;
  pos: { q: number; r: number };
  symbol: string;
}): void {
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
        ${PROMOTION_CHOICES.map(
          (type) => `
          <button class="promotion-choice" data-type="${type}" data-key="${keyHints[type]}" style="border-color:${color.primary}" title="${names[type]} (Taste: ${keyHints[type]})">
            <span class="choice-symbol">${symbols[type]}</span>
            <span class="choice-name">${names[type]}</span>
            <span class="choice-key">${keyHints[type]}</span>
          </button>
        `,
        ).join("")}
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
        const type = btn.dataset.type;
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
      const newType = btn.dataset.type;
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

function handlePromotionResult(
  result: {
    piece: { id: string; symbol: string; faction: string };
    notation: string;
  },
  piece: { id: string },
): void {
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
    const depth = parseInt((e.target as HTMLInputElement).value);
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
    game._undoStack = [];
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
      game._undoStack = [];

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
    window.replayController?.goToStart();
    applyGameState(window.replayController.getCurrentState());
    updateReplayUI();
  });

  replayPrev?.addEventListener("click", () => {
    window.replayController?.previous();
    applyGameState(window.replayController.getCurrentState());
    updateReplayUI();
  });

  replayPlayBtn?.addEventListener("click", () => {
    replayPlay();
  });

  replayPauseBtn?.addEventListener("click", () => {
    stopReplayPlay();
  });

  replayNext?.addEventListener("click", () => {
    window.replayController?.next();
    applyGameState(window.replayController.getCurrentState());
    updateReplayUI();
  });

  replayLast?.addEventListener("click", () => {
    window.replayController?.goToEnd();
    applyGameState(window.replayController.getCurrentState());
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
      alert("Export fehlgeschlagen: " + err.message);
    }
  });

  replaySpeed?.addEventListener("input", () => {
    if (replayPlayTimer) {
      replayPlay();
    }
  });

  // Personality Selector
  const personalitySelect = document.getElementById(
    "personality-select",
  ) as HTMLSelectElement;
  personalitySelect?.addEventListener("change", (e: Event) => {
    const personality = (e.target as HTMLSelectElement).value;
    setAIPersonality(personality);
    if (aiWorker && workerReady) {
      aiWorker.postMessage({ type: "setPersonality", depth: personality });
    }
    saveSettings({ ...loadSettings(), aiPersonality: personality });
  });
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
