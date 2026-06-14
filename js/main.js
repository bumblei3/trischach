import { BoardRenderer, FACTION_COLORS, FACTION } from "./board.js";
import { Game, GAME_STATE, PROMOTION_CHOICES } from "./game.js";
import {
  calculateBestMove,
  evaluateBoard,
  setAIDepth,
  setAIPersonality,
  getAIPersonalities,
} from "./ai.js";
import { sounds } from "./sounds.js";
import { buildOpeningBook } from "./opening-book.js";
import {
  serializeGame,
  downloadGame,
  copyGameToClipboard,
  loadGameFromFile,
  parseTSPN,
  reconstructGameFromTSPN,
  ReplayController,
} from "./replay.js";

// ─── Settings Persistence (localStorage) ────────────────────────────────
const STORAGE_KEY = "trischach-settings";

const DEFAULT_SETTINGS = {
  rpsEnabled: true,
  soundEnabled: true,
  aiDepth: 3,
  boardRotation: 0,
  autoBattle: false,
  aiPersonality: "balanced",
};

// Depth names (needed by applySettings before DOM elements exist)
const depthNames = { 1: "Leicht", 2: "Mittel", 3: "Schwer", 4: "Extrem" };

function loadSettings() {
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

function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn("Failed to save settings:", e);
  }
}

function applySettings(settings) {
  // RPS Toggle
  game.rpsEnabled = settings.rpsEnabled;
  rpsToggle.checked = settings.rpsEnabled;

  // Sound Toggle
  sounds.toggle(settings.soundEnabled);
  soundToggle.checked = settings.soundEnabled;

  // AI Depth
  setAIDepth(settings.aiDepth);
  depthSlider.value = settings.aiDepth;
  depthLabel.textContent = "KI: " + depthNames[settings.aiDepth];

  // Board Rotation
  currentBoardRotation = settings.boardRotation % 360;
  renderer.setRotation(currentBoardRotation);

  // Auto Battle (just sync button state, don't start)
  autoBattleActive = settings.autoBattle;
  if (autoBattleActive) {
    autoBattleBtn.textContent = "⏹ Auto Battle Stoppen";
    autoBattleBtn.classList.add("active");
  } else {
    autoBattleBtn.textContent = "🤖 Auto Battle";
    autoBattleBtn.classList.remove("active");
  }

  // AI Personality
  setAIPersonality(settings.aiPersonality);
  personalitySelect.value = settings.aiPersonality;

  updateUI();
}

const svg = document.getElementById("board-svg");
const statusEl = document.getElementById("status");
const turnEl = document.getElementById("turn-indicator");
const rpsInfoEl = document.getElementById("rps-info");
const combatOverlay = document.getElementById("combat-overlay");
const promotionOverlay = document.getElementById("promotion-overlay");
const restartBtn = document.getElementById("restart-btn");
const autoBattleBtn = document.getElementById("auto-battle-btn");
const rpsToggle = document.getElementById("rps-toggle");
const soundToggle = document.getElementById("sound-toggle");
const rotateBtn = document.getElementById("rotate-btn");
const moveLogEl = document.getElementById("move-log");

const saveBtn = document.getElementById("save-btn");
const loadBtn = document.getElementById("load-btn");
const copyBtn = document.getElementById("copy-btn");

// Hidden file input for loading
const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = ".tspn,text/plain";
fileInput.style.display = "none";
document.body.appendChild(fileInput);

const personalitySelect = document.getElementById("personality-select");

const renderer = new BoardRenderer(svg);
const game = new Game();

// AI Worker
let aiWorker = null;
let workerReady = false;
let pendingWorkerCallback = null;

function initAIWorker() {
  try {
    aiWorker = new Worker("./ai-worker.js", { type: "module" });
    aiWorker.onmessage = (e) => {
      const { type, move, depth, score, nodes } = e.data;
      if (type === "result" && pendingWorkerCallback) {
        pendingWorkerCallback(move);
        pendingWorkerCallback = null;
      } else if (type === "progress") {
        // Could update UI with search progress
        console.log(`AI depth ${depth}: score ${score}, nodes ${nodes}`);
      } else if (type === "bookReady") {
        workerReady = true;
      }
    };
    aiWorker.onerror = (err) => {
      console.warn("AI Worker error, falling back to main thread:", err);
      aiWorker = null;
    };
    // Initialize opening book in worker
    aiWorker.postMessage({ type: "initBook" });
  } catch (e) {
    console.warn("Web Worker not supported, using main thread AI");
    aiWorker = null;
  }
}

function calculateBestMoveWorker(game, faction) {
  return new Promise((resolve) => {
    if (!aiWorker || !workerReady) {
      // Fallback to main thread - convert to worker format
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
    aiWorker.postMessage({ type: "calculate", gameState, faction });
  });
}

function serializeGameForWorker(game) {
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

let autoBattleActive = false;
let autoBattleTimer = null;

function init() {
  renderer.render();
  game.init(renderer.cells);
  game._undoStack = [];
  // Build opening book (first time only)
  buildOpeningBook(Game);
  // Initialize AI Worker
  initAIWorker();
  // Load and apply persisted settings
  const settings = loadSettings();
  applySettings(settings);
  // Add tooltips to hex cells
  for (const [key, cell] of renderer.hexElements) {
    const c = game.boardCells.get(key);
    cell.polygon.setAttribute("title", `Coord: ${c.hex.q},${c.hex.r}`);
  }
  // Render all pieces
  for (const p of game.getAlivePieces()) renderer.renderPiece(p);
  updateUI();
}

function updateUI() {
  const f = game.currentFaction;
  const fc = FACTION_COLORS[f];
  turnEl.textContent = fc.name;
  turnEl.style.color = fc.primary;

  // Status text: show check state
  if (game.state === GAME_STATE.GAME_OVER) {
    // keep existing game over text
  } else if (game.isKingInCheck(f)) {
    statusEl.textContent = "⚠️ Schach!";
    statusEl.style.color = "#ff4444";
  } else {
    statusEl.textContent =
      game.state === GAME_STATE.SELECT_PIECE
        ? "Wähle eine Figur"
        : "Wähle ein Ziel";
    statusEl.style.color = "";
  }

  // Highlight king hex when in check
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

  // Update eliminated indicators
  for (const fac of [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]) {
    const el = document.getElementById(`panel-${fac}`);
    if (el && game.eliminatedFactions.has(fac)) el.classList.add("eliminated");
  }
  // Update RPS visual state
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
  // Update Captures
  for (const fac of [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]) {
    const capEl = document.getElementById(`captures-${fac}`);
    if (capEl) {
      capEl.innerHTML = game.capturedPieces[fac]
        .map((p) => `<span class="captured-piece">${p.symbol}</span>`)
        .join("");
    }
  }

  // Update Eval Bar
  updateEvalBar();
}

function updateEvalBar() {
  const fireEval = evaluateBoard(game, FACTION.FIRE);
  const natureEval = evaluateBoard(game, FACTION.NATURE);
  const waterEval = evaluateBoard(game, FACTION.WATER);

  // Normalize: shift so minimum is 0, then scale to 100%
  const minEval = Math.min(fireEval, natureEval, waterEval);
  const shifted = [
    fireEval - minEval,
    natureEval - minEval,
    waterEval - minEval,
  ];
  const maxShifted = Math.max(...shifted, 1); // avoid div by zero

  const firePct = (shifted[0] / maxShifted) * 100;
  const naturePct = (shifted[1] / maxShifted) * 100;
  const waterPct = (shifted[2] / maxShifted) * 100;

  document.getElementById("eval-fire").style.width = firePct + "%";
  document.getElementById("eval-nature").style.width = naturePct + "%";
  document.getElementById("eval-water").style.width = waterPct + "%";
}

function clearCheckHighlight() {
  document
    .querySelectorAll(".highlight-check")
    .forEach((el) => el.classList.remove("highlight-check"));
}

function addToLog(result) {
  const entry = document.createElement("div");
  entry.className = `move-entry ${result.piece.faction}`;
  entry.innerHTML = `
    <span class="move-piece">${result.piece.symbol}</span>
    <span class="move-coords">${result.notation}</span>
  `;
  moveLogEl.appendChild(entry);
  moveLogEl.scrollTop = moveLogEl.scrollHeight;
}

renderer.onCellClick = (hex) => {
  const result = game.handleCellClick(hex);
  if (!result) return;

  renderer.clearHighlights();
  renderer.clearSelection();

  if (result.action === "select") {
    sounds.playSelect();
    renderer.selectCell(hex);
    renderer.highlightCells(result.moves, "highlight-move");
    // Color-code attacks by RPS result
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
    if (result.promotion) {
      showPromotion(game.pendingPromotion);
    } else {
      updateUI();
    }
  } else if (result.action === "combat") {
    addToLog(result);
    showCombat(result);
  }

  // Play check sound if a faction is in check after the move
  if (
    result.inCheck &&
    result.action !== "select" &&
    result.action !== "deselect"
  ) {
    sounds.playCheck();
  }

  if (result.action === "select" || result.action === "deselect") updateUI();
};

// Piece long-press context menu
let contextMenuPiece = null;
let contextMenuActions = null;

renderer.onPieceLongPress = (piece, position) => {
  if (game.state === GAME_STATE.GAME_OVER) return;
  if (piece.faction !== game.currentFaction) return; // Only allow for current player's pieces

  contextMenuPiece = piece;
  showContextMenu(piece, position);
};

function showContextMenu(piece, position) {
  // Remove existing context menu
  const existing = document.getElementById("piece-context-menu");
  if (existing) existing.remove();

  // Get legal moves for this piece
  const { moves, attacks } = game.getLegalMoves(piece);
  const hasMoves = moves.length > 0 || attacks.length > 0;

  const menu = document.createElement("div");
  menu.id = "piece-context-menu";
  menu.className = "piece-context-menu";
  menu.style.left = `${position.clientX}px`;
  menu.style.top = `${position.clientY}px`;

  // Build menu items
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

  // Position adjustment to keep menu in viewport
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

  // Event listeners for menu items
  menu.querySelectorAll(".context-menu-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      handleContextMenuAction(btn.dataset.action, piece);
      hideContextMenu();
    });
  });

  // Close on outside click
  const closeOnClick = (e) => {
    if (!menu.contains(e.target)) {
      hideContextMenu();
      document.removeEventListener("click", closeOnClick);
    }
  };
  setTimeout(() => document.addEventListener("click", closeOnClick), 0);
}

function handleContextMenuAction(action, piece) {
  switch (action) {
    case "show-moves":
      // Select piece and show its moves
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
    case "undo":
      const snap = game.undo();
      if (snap) {
        updateUI();
      }
      break;
    case "save":
      // Click save - should trigger download
      const downloadPromise = new Promise((resolve) => {
        const tempClick = () => {
          const download = Array.from(document.querySelectorAll("a")).find(
            (a) => a.download && a.href,
          );
          if (download) resolve(download);
        };
        // Trigger save button click
        saveBtn.click();
        setTimeout(() => {
          // The save button triggers a download event
          resolve();
        }, 100);
      });
      downloadPromise;
      break;
    case "copy":
      // Grant clipboard permission and copy
      navigator.clipboard
        .writeText(window.replayController?.exportTSPN() || "")
        .then(() => {
          // Could show a toast notification
          console.log("TSPN copied to clipboard");
        });
      break;
  }
}

function hideContextMenu() {
  const existing = document.getElementById("piece-context-menu");
  if (existing) existing.remove();
}

function triggerAutoMove() {
  clearTimeout(autoBattleTimer);
  autoBattleTimer = setTimeout(async () => {
    if (!autoBattleActive || game.state === GAME_STATE.GAME_OVER) return;

    // Safety check: if game is somehow expecting a target but AI just calculates fresh move, reset selection
    if (game.state === GAME_STATE.SELECT_TARGET && game.selectedPiece) {
      game.handleCellClick(game.selectedPiece.pos); // Deselect
    }

    // Safety: skip eliminated factions
    if (game.eliminatedFactions.has(game.currentFaction)) {
      game._nextTurn();
      triggerAutoMove();
      return;
    }

    const action = await calculateBestMoveWorker(game, game.currentFaction);

    if (action) {
      // Execute the action programmatically
      const piece = game.pieces.find((p) => p.id === action.pieceId);
      if (!piece) {
        console.error("Piece not found:", action.pieceId);
        triggerAutoMove();
        return;
      }
      game.handleCellClick(piece.pos); // Select piece
      const target = new (await import("./hex.js")).Hex(
        action.targetQ,
        action.targetR,
      );
      const result = game.handleCellClick(target); // Execute move/attack

      renderer.clearHighlights();
      renderer.clearSelection();

      if (result && result.action === "move") {
        sounds.playMove();
        addToLog(result);
        renderer.renderPiece(result.piece);
        if (result.promotion) {
          // Auto-promote to queen in auto-battle
          const promoResult = game.completePromotion("queen");
          if (promoResult) {
            renderer.removePiece(result.piece.id);
            renderer.renderPiece(result.piece);
            addToLog(promoResult);
          }
          updateUI();
          triggerAutoMove();
        } else {
          updateUI();
          triggerAutoMove(); // Queue next move
        }
      } else if (result && result.action === "combat") {
        addToLog(result);
        showCombat(result);
        // showCombat will trigger the next auto move after animation
      } else {
        // Unexpected result, stop auto battle
        autoBattleActive = false;
        autoBattleBtn.textContent = "🤖 Auto Battle";
        autoBattleBtn.classList.remove("active");
        updateUI();
      }
    } else {
      // No valid moves for this faction - could be stalemate or elimination
      // Check if game is over, otherwise skip to next faction
      const aliveFactions = [
        FACTION.FIRE,
        FACTION.WATER,
        FACTION.NATURE,
      ].filter((f) => !game.eliminatedFactions.has(f));
      if (aliveFactions.length <= 1) {
        game.state = GAME_STATE.GAME_OVER;
        updateUI();
      } else {
        // Skip this faction's turn and continue
        game._nextTurn();
        triggerAutoMove();
      }
    }
  }, 400); // 400ms delay between AI moves
}

function showCombat(result) {
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
      ${result.gameOver ? `<div class="combat-winner">🏆 ${FACTION_COLORS[result.winner_faction].name} gewinnt!</div>` : ""}
      ${autoBattleActive && !result.gameOver ? `<button id="stop-auto-combat" class="combat-stop-btn">⏹ Auto Battle Stoppen</button>` : ""}
    </div>
  `;
  combatOverlay.classList.add("visible");

  const stopBtn = document.getElementById("stop-auto-combat");
  if (stopBtn) {
    stopBtn.onclick = () => {
      autoBattleActive = false;
      autoBattleBtn.textContent = "🤖 Auto Battle";
      autoBattleBtn.classList.remove("active");
      clearTimeout(autoBattleTimer);
      stopBtn.remove();
    };
  }

  setTimeout(() => {
    combatOverlay.classList.remove("visible");
    // Re-render pieces
    const boardGroup = document.getElementById("board-group");
    boardGroup.querySelectorAll(".piece").forEach((el) => el.remove());
    renderer.pieceElements.clear();
    for (const p of game.getAlivePieces()) renderer.renderPiece(p);
    updateUI();
    if (result.elimination) sounds.playElimination();
    if (result.stalemate) sounds.playStalemate();

    if (result.gameOver) {
      sounds.playWin();
      statusEl.textContent = `🏆 ${FACTION_COLORS[result.winner_faction].name} hat gewonnen!`;
      autoBattleActive = false;
      autoBattleBtn.textContent = "🤖 Auto Battle";
      autoBattleBtn.classList.remove("active");
    } else if (autoBattleActive) {
      triggerAutoMove();
    }
  }, 2200);
}

function showPromotion(piece) {
  const color = FACTION_COLORS[piece.faction];
  const names = {
    queen: "Dame",
    rook: "Turm",
    bishop: "Läufer",
    knight: "Springer",
  };
  const symbols = { queen: "♛", rook: "♜", bishop: "♝", knight: "♞" };
  const keyHints = { queen: "Q", rook: "R", bishop: "B", knight: "N" };

  // Load auto-queen setting
  const settings = loadSettings();
  const autoQueen = settings.autoQueen === true;

  promotionOverlay.innerHTML = `
    <div class="promotion-box">
      <div class="promotion-title" style="color:${color.primary}">
        Bauer promoviert! Wähle eine Figur:
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

  // Auto-queen checkbox handler
  const autoQueenCheckbox = document.getElementById("auto-queen-checkbox");
  autoQueenCheckbox.addEventListener("change", (e) => {
    const settings = loadSettings();
    settings.autoQueen = e.target.checked;
    saveSettings(settings);
  });

  // If auto-queen is enabled, auto-promote to queen
  if (autoQueen) {
    setTimeout(() => {
      promotionOverlay.classList.remove("visible");
      const result = game.completePromotion("queen");
      if (result) {
        handlePromotionResult(result, piece);
      }
    }, 100);
    return;
  }

  // Click handlers for promotion choices
  promotionOverlay.querySelectorAll(".promotion-choice").forEach((btn) => {
    btn.addEventListener("click", () => {
      const newType = btn.dataset.type;
      promotionOverlay.classList.remove("visible");
      const result = game.completePromotion(newType);
      if (result) {
        handlePromotionResult(result, piece);
      }
    });
  });

  // Keyboard shortcuts handler
  const keyHandler = (e) => {
    if (!promotionOverlay.classList.contains("visible")) return;

    const key = e.key.toLowerCase();
    const keyMap = { q: "queen", r: "rook", b: "bishop", n: "knight" };

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

  // Cleanup on overlay close
  const cleanup = () => {
    document.removeEventListener("keydown", keyHandler);
    promotionOverlay.removeEventListener("transitionend", cleanup);
  };
  promotionOverlay.addEventListener("transitionend", cleanup);
}

// Shared promotion result handler
function handlePromotionResult(result, piece) {
  addToLog(result);
  // Re-render the promoted piece
  renderer.removePiece(piece.id);
  renderer.renderPiece(piece);
  updateUI();
  sounds.playPromotion();
}

autoBattleBtn.addEventListener("click", () => {
  if (game.state === GAME_STATE.GAME_OVER) return;
  autoBattleActive = !autoBattleActive;
  if (autoBattleActive) {
    autoBattleBtn.textContent = "⏹ Auto Battle Stoppen";
    autoBattleBtn.classList.add("active");
    triggerAutoMove();
  } else {
    autoBattleBtn.textContent = "🤖 Auto Battle";
    autoBattleBtn.classList.remove("active");
    clearTimeout(autoBattleTimer);
  }
  saveSettings({ ...loadSettings(), autoBattle: autoBattleActive });
});

const undoBtn = document.getElementById("undo-btn");
undoBtn.addEventListener("click", () => {
  const snap = game.undo();
  if (snap) {
    updateUI();
  }
});

rpsToggle.addEventListener("change", (e) => {
  game.rpsEnabled = e.target.checked;
  updateUI();
  saveSettings({ ...loadSettings(), rpsEnabled: e.target.checked });
});

soundToggle.addEventListener("change", (e) => {
  sounds.toggle(e.target.checked);
  saveSettings({ ...loadSettings(), soundEnabled: e.target.checked });
});

// AI Difficulty Slider
const depthSlider = document.getElementById("depth-slider");
const depthLabel = document.getElementById("depth-label");
depthSlider.addEventListener("input", (e) => {
  const depth = parseInt(e.target.value);
  setAIDepth(depth);
  depthLabel.textContent = "KI: " + depthNames[depth];
  saveSettings({ ...loadSettings(), aiDepth: depth });
});

let currentBoardRotation = 0;
rotateBtn.addEventListener("click", () => {
  currentBoardRotation += 120;
  renderer.setRotation(currentBoardRotation);
  saveSettings({ ...loadSettings(), boardRotation: currentBoardRotation });
});

restartBtn.addEventListener("click", () => {
  combatOverlay.classList.remove("visible");
  promotionOverlay.classList.remove("visible");
  const boardGroup = document.getElementById("board-group");
  boardGroup.querySelectorAll(".piece").forEach((el) => el.remove());
  renderer.pieceElements.clear();
  game.init(renderer.cells);
  game._undoStack = [];
  moveLogEl.innerHTML = "";
  for (const p of game.getAlivePieces()) renderer.renderPiece(p);
  for (const fac of [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]) {
    const el = document.getElementById(`panel-${fac}`);
    if (el) el.classList.remove("eliminated");
  }

  autoBattleActive = false;
  autoBattleBtn.textContent = "🤖 Auto Battle";
  autoBattleBtn.classList.remove("active");
  clearTimeout(autoBattleTimer);

  saveSettings({ ...loadSettings(), autoBattle: false });

  updateUI();
});

// Replay: Save game
saveBtn.addEventListener("click", () => {
  downloadGame(game, `trischach-${new Date().toISOString().slice(0, 10)}.tspn`);
});

// Replay: Copy to clipboard
copyBtn.addEventListener("click", async () => {
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

// Replay: Load game file
loadBtn.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const parsed = await loadGameFromFile(file);
    console.log("Loaded game:", parsed.headers);

    // Reconstruct game from TSPN
    const { game: replayGame, controller: replayController } =
      reconstructGameFromTSPN(parsed, Game, renderer.cells);

    // Stop any running auto-battle
    autoBattleActive = false;
    autoBattleBtn.textContent = "🤖 Auto Battle";
    autoBattleBtn.classList.remove("active");
    clearTimeout(autoBattleTimer);

    // Replace current game with replay game
    Object.assign(game, replayGame);
    game._undoStack = [];

    // Set up replay controller
    window.replayController = replayController;

    // Re-render board
    const boardGroup = document.getElementById("board-group");
    boardGroup.querySelectorAll(".piece").forEach((el) => el.remove());
    renderer.pieceElements.clear();
    for (const p of game.getAlivePieces()) renderer.renderPiece(p);

    // Clear move log and rebuild from replay
    moveLogEl.innerHTML = "";
    for (const move of parsed.moves) {
      // Add simplified notation to move log
      const entry = document.createElement("div");
      entry.className = `move-entry ${move.faction}`;
      entry.textContent = `${move.faction} ${move.san}`;
      moveLogEl.appendChild(entry);
    }

    // Show replay controls
    showReplayControls();
    updateReplayUI();

    // Update UI
    updateUI();
  } catch (err) {
    console.error("Load failed:", err);
    alert("Fehler beim Laden: " + err.message);
  }

  // Reset file input
  fileInput.value = "";
});

// Replay controls
let replayPlayTimer = null;

function showReplayControls() {
  const replayControls = document.getElementById("replay-controls");
  if (replayControls) replayControls.style.display = "flex";
}

function hideReplayControls() {
  const replayControls = document.getElementById("replay-controls");
  if (replayControls) replayControls.style.display = "none";
}

function updateReplayUI() {
  const controller = window.replayController;
  if (!controller) return;

  const moveInfo = document.getElementById("replay-move-info");
  if (moveInfo) {
    const moveNum = controller.getCurrentMoveNumber();
    const total = controller.getTotalMoves();
    moveInfo.textContent = `Zug ${moveNum} / ${total}`;
  }

  const isAtEnd = !controller.canGoForward();
  const isAtStart = !controller.canGoBack();

  const replayFirst = document.getElementById("replay-first");
  const replayPrev = document.getElementById("replay-prev");
  const replayNext = document.getElementById("replay-next");
  const replayLast = document.getElementById("replay-last");
  const replayPlay = document.getElementById("replay-play");
  const replayPause = document.getElementById("replay-pause");

  if (replayFirst) replayFirst.disabled = isAtStart;
  if (replayPrev) replayPrev.disabled = isAtStart;
  if (replayNext) replayNext.disabled = isAtEnd;
  if (replayLast) replayLast.disabled = isAtEnd;
  if (replayPlay) replayPlay.style.display = isAtEnd ? "none" : "inline-block";
  if (replayPause) replayPause.style.display = "none";

  // Update move log highlight
  const moveEntries = moveLogEl.querySelectorAll(".move-entry");
  moveEntries.forEach((entry, index) => {
    entry.classList.toggle(
      "current-move",
      index === window.replayController?.getCurrentMoveNumber() - 1,
    );
  });
}

function replayStep(delta) {
  const controller = window.replayController;
  if (!controller) return;

  if (delta > 0) controller.next();
  else controller.previous();

  // Apply state to game
  const state = controller.getCurrentState();
  if (state) applyGameState(state);

  updateReplayUI();
}

function replayPlay() {
  stopReplayPlay();
  const controller = window.replayController;
  if (!controller || !controller.canGoForward()) return;

  const replayPlay = document.getElementById("replay-play");
  const replayPause = document.getElementById("replay-pause");
  if (replayPlay) replayPlay.style.display = "none";
  if (replayPause) replayPause.style.display = "inline-block";

  const speed = parseFloat(
    document.getElementById("replay-speed")?.value || "1",
  );
  const delay = 1000 / speed;

  replayPlayTimer = setInterval(() => {
    const controller = window.replayController;
    if (!controller || !controller.canGoForward()) {
      stopReplayPlay();
      return;
    }
    controller.next();
    const state = controller.getCurrentState();
    if (state) applyGameState(state);
    updateReplayUI();
  }, delay);
}

function stopReplayPlay() {
  if (replayPlayTimer) {
    clearInterval(replayPlayTimer);
    replayPlayTimer = null;
  }
  const replayPlay = document.getElementById("replay-play");
  const replayPause = document.getElementById("replay-pause");
  if (replayPlay) replayPlay.style.display = "inline-block";
  if (replayPause) replayPause.style.display = "none";
}

function applyGameState(state) {
  // Clear current pieces
  const boardGroup = document.getElementById("board-group");
  if (boardGroup) {
    boardGroup.querySelectorAll(".piece").forEach((el) => el.remove());
  }
  renderer.pieceElements.clear();

  // Apply pieces
  for (const p of state.pieces) {
    if (p.alive) {
      const piece = game.pieces.find((piece) => piece.id === p.id);
      if (piece) {
        Object.assign(piece, p);
        renderer.renderPiece(piece);
      }
    }
  }

  // Update game state
  game.currentFaction = state.currentFaction;
  game.currentFactionIdx = state.currentFactionIdx;
  game.state = state.state;
  game.eliminatedFactions = new Set(state.eliminatedFactions);
  game.capturedPieces = {
    fire: state.capturedPieces.fire
      .map((id) => game.pieces.find((p) => p.id === id))
      .filter(Boolean),
    water: state.capturedPieces.water
      .map((id) => game.pieces.find((p) => p.id === id))
      .filter(Boolean),
    nature: state.capturedPieces.nature
      .map((id) => game.pieces.find((p) => p.id === id))
      .filter(Boolean),
  };

  // Update UI
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

// Replay controls event listeners
const replayFirst = document.getElementById("replay-first");
const replayPrev = document.getElementById("replay-prev");
const replayPlayBtn = document.getElementById("replay-play");
const replayPauseBtn = document.getElementById("replay-pause");
const replayNext = document.getElementById("replay-next");
const replayLast = document.getElementById("replay-last");
const replaySpeed = document.getElementById("replay-speed");

if (replayFirst)
  replayFirst.addEventListener("click", () => {
    window.replayController?.goToStart();
    applyGameState(window.replayController.getCurrentState());
    updateReplayUI();
  });

if (replayPrev)
  replayPrev.addEventListener("click", () => {
    window.replayController?.previous();
    applyGameState(window.replayController.getCurrentState());
    updateReplayUI();
  });

if (replayPlayBtn)
  replayPlayBtn.addEventListener("click", () => {
    replayPlay();
  });

if (replayPauseBtn)
  replayPauseBtn.addEventListener("click", () => {
    stopReplayPlay();
  });

if (replayNext)
  replayNext.addEventListener("click", () => {
    window.replayController?.next();
    applyGameState(window.replayController.getCurrentState());
    updateReplayUI();
  });

if (replayLast)
  replayLast.addEventListener("click", () => {
    window.replayController?.goToEnd();
    applyGameState(window.replayController.getCurrentState());
    updateReplayUI();
  });

if (replaySpeed)
  replaySpeed.addEventListener("input", () => {
    if (replayPlayTimer) {
      replayPlay();
    }
  });

// Personality selector
personalitySelect.addEventListener("change", (e) => {
  const personality = e.target.value;
  setAIPersonality(personality);
  if (aiWorker && workerReady) {
    aiWorker.postMessage({ type: "setPersonality", depth: personality });
  }
  saveSettings({ ...loadSettings(), aiPersonality: personality });
});

init();

export { game, renderer, triggerAutoMove };
