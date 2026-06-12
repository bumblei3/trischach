import { BoardRenderer, FACTION_COLORS, FACTION } from './board.js';
import { Game, GAME_STATE, PROMOTION_CHOICES } from './game.js';
import { calculateBestMove, evaluateBoard, setAIDepth } from './ai.js';
import { sounds } from './sounds.js';
import { buildOpeningBook } from './opening-book.js';

const svg = document.getElementById('board-svg');
const statusEl = document.getElementById('status');
const turnEl = document.getElementById('turn-indicator');
const rpsInfoEl = document.getElementById('rps-info');
const combatOverlay = document.getElementById('combat-overlay');
const promotionOverlay = document.getElementById('promotion-overlay');
const restartBtn = document.getElementById('restart-btn');
const autoBattleBtn = document.getElementById('auto-battle-btn');
const rpsToggle = document.getElementById('rps-toggle');
const soundToggle = document.getElementById('sound-toggle');
const rotateBtn = document.getElementById('rotate-btn');
const moveLogEl = document.getElementById('move-log');

const renderer = new BoardRenderer(svg);
const game = new Game();

let autoBattleActive = false;
let autoBattleTimer = null;

function init() {
  renderer.render();
  game.init(renderer.cells);
    game._undoStack = [];
  // Build opening book (first time only)
  buildOpeningBook(Game);
  // Add tooltips to hex cells
  for (const [key, cell] of renderer.hexElements) {
    const c = game.boardCells.get(key);
    cell.polygon.setAttribute('title', `Coord: ${c.hex.q},${c.hex.r}`);
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
    statusEl.textContent = '⚠️ Schach!';
    statusEl.style.color = '#ff4444';
  } else {
    statusEl.textContent = game.state === GAME_STATE.SELECT_PIECE
      ? 'Wähle eine Figur'
      : 'Wähle ein Ziel';
    statusEl.style.color = '';
  }

  // Highlight king hex when in check
  clearCheckHighlight();
  if (game.isKingInCheck(f)) {
    const king = game.pieces.find(p => p.faction === f && p.type === 'king' && p.alive);
    if (king) {
      const el = renderer.hexElements.get(king.pos.key);
      if (el) el.polygon.classList.add('highlight-check');
    }
  }

  // Update eliminated indicators
  for (const fac of [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]) {
    const el = document.getElementById(`panel-${fac}`);
    if (el && game.eliminatedFactions.has(fac)) el.classList.add('eliminated');
  }
  // Update RPS visual state
  if (game.rpsEnabled) {
    rpsInfoEl.classList.remove('rps-inactive');
    document.querySelectorAll('.rps-hint').forEach(el => el.classList.remove('hidden'));
  } else {
    rpsInfoEl.classList.add('rps-inactive');
    document.querySelectorAll('.rps-hint').forEach(el => el.classList.add('hidden'));
  }
  // Update Captures
  for (const fac of [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]) {
    const capEl = document.getElementById(`captures-${fac}`);
    if (capEl) {
      capEl.innerHTML = game.capturedPieces[fac].map(p => `<span class="captured-piece">${p.symbol}</span>`).join('');
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
  const shifted = [fireEval - minEval, natureEval - minEval, waterEval - minEval];
  const maxShifted = Math.max(...shifted, 1); // avoid div by zero

  const firePct = (shifted[0] / maxShifted) * 100;
  const naturePct = (shifted[1] / maxShifted) * 100;
  const waterPct = (shifted[2] / maxShifted) * 100;

  document.getElementById('eval-fire').style.width = firePct + '%';
  document.getElementById('eval-nature').style.width = naturePct + '%';
  document.getElementById('eval-water').style.width = waterPct + '%';
}

function clearCheckHighlight() {
  document.querySelectorAll('.highlight-check').forEach(el => el.classList.remove('highlight-check'));
}

function addToLog(result) {
  const entry = document.createElement('div');
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

  if (result.action === 'select') {
    sounds.playSelect();
    renderer.selectCell(hex);
    renderer.highlightCells(result.moves, 'highlight-move');
    // Color-code attacks by RPS result
    if (game.rpsEnabled && result.rpsAttacks) {
      renderer.highlightCells(result.rpsAttacks.advantage, 'highlight-attack-advantage');
      renderer.highlightCells(result.rpsAttacks.disadvantage, 'highlight-attack-disadvantage');
      renderer.highlightCells(result.rpsAttacks.neutral, 'highlight-attack');
    } else {
      renderer.highlightCells(result.attacks, 'highlight-attack');
    }
  } else if (result.action === 'deselect') {
    // nothing
  } else if (result.action === 'move') {
    sounds.playMove();
    addToLog(result);
    renderer.renderPiece(result.piece);
    if (result.promotion) {
      showPromotion(game.pendingPromotion);
    } else {
      updateUI();
    }
  } else if (result.action === 'combat') {
    addToLog(result);
    showCombat(result);
  }

  // Play check sound if a faction is in check after the move
  if (result.inCheck && result.action !== 'select' && result.action !== 'deselect') {
    sounds.playCheck();
  }

  if (result.action === 'select' || result.action === 'deselect') updateUI();
};

function triggerAutoMove() {
  if (!autoBattleActive || game.state === GAME_STATE.GAME_OVER) return;

  clearTimeout(autoBattleTimer);
  autoBattleTimer = setTimeout(() => {
    if (!autoBattleActive || game.state === GAME_STATE.GAME_OVER) return;

    // Safety check: if game is somehow expecting a target but AI just calculates fresh move, reset selection
    if (game.state === GAME_STATE.SELECT_TARGET) {
      game.handleCellClick(game.selectedPiece.pos); // Deselect
    }

    // Safety: skip eliminated factions
    if (game.eliminatedFactions.has(game.currentFaction)) {
      game._nextTurn();
      triggerAutoMove();
      return;
    }

    const action = calculateBestMove(game, game.currentFaction);

    if (action) {
      // Execute the action programmatically
      game.handleCellClick(action.piece.pos); // Select piece
      const result = game.handleCellClick(action.target); // Execute move/attack

      renderer.clearHighlights();
      renderer.clearSelection();

      if (result && result.action === 'move') {
        sounds.playMove();
        addToLog(result);
        renderer.renderPiece(result.piece);
        if (result.promotion) {
          // Auto-promote to queen in auto-battle
          const promoResult = game.completePromotion('queen');
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
      } else if (result && result.action === 'combat') {
        addToLog(result);
        showCombat(result);
        // showCombat will trigger the next auto move after animation
      } else {
        // Unexpected result, stop auto battle
        autoBattleActive = false;
        autoBattleBtn.textContent = '🤖 Auto Battle';
        autoBattleBtn.classList.remove('active');
        updateUI();
      }
    } else {
      // No valid moves for this faction - could be stalemate or elimination
      // Check if game is over, otherwise skip to next faction
      const aliveFactions = [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]
        .filter(f => !game.eliminatedFactions.has(f));
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
        <div class="combat-vs">${rps === 'advantage' ? '>' : '<'}</div>
        <div class="fighter" style="color:${defColor.primary}">
          <span class="fighter-symbol">${result.defender.symbol}</span>
          <span class="fighter-name">${defColor.name}</span>
        </div>
      </div>
      <div class="combat-result ${rps}">
        ${rps === 'advantage'
          ? `${attColor.name} besiegt ${defColor.name}!`
          : `${defColor.name} wehrt ab! ${attColor.name} verliert!`}
      </div>
      ${result.elimination ? `<div class="combat-elimination">💀 ${FACTION_COLORS[result.elimination].name} ist eliminiert!</div>` : ''}
      ${result.checkmate ? `<div class="combat-checkmate">♚ Schachmatt! ${FACTION_COLORS[result.checkmate].name} ist eliminiert!</div>` : ''}
      ${result.stalemate ? `<div class="combat-stalemate">🤖 Patt! ${FACTION_COLORS[result.stalemate].name} ist eliminiert!</div>` : ''}
      ${result.inCheck && !result.checkmate ? `<div class="combat-check">⚠️ Schach!</div>` : ''}
      ${result.gameOver ? `<div class="combat-winner">🏆 ${FACTION_COLORS[result.winner_faction].name} gewinnt!</div>` : ''}
      ${autoBattleActive && !result.gameOver ? `<button id="stop-auto-combat" class="combat-stop-btn">⏹ Auto Battle Stoppen</button>` : ''}
    </div>
  `;
  combatOverlay.classList.add('visible');

  const stopBtn = document.getElementById('stop-auto-combat');
  if (stopBtn) {
    stopBtn.onclick = () => {
      autoBattleActive = false;
      autoBattleBtn.textContent = '🤖 Auto Battle';
      autoBattleBtn.classList.remove('active');
      clearTimeout(autoBattleTimer);
      stopBtn.remove();
    };
  }

  setTimeout(() => {
    combatOverlay.classList.remove('visible');
    // Re-render pieces
    const boardGroup = document.getElementById('board-group');
    boardGroup.querySelectorAll('.piece').forEach(el => el.remove());
    renderer.pieceElements.clear();
    for (const p of game.getAlivePieces()) renderer.renderPiece(p);
    updateUI();
    if (result.elimination) sounds.playElimination();
    if (result.stalemate) sounds.playStalemate();

    if (result.gameOver) {
      sounds.playWin();
      statusEl.textContent = `🏆 ${FACTION_COLORS[result.winner_faction].name} hat gewonnen!`;
      autoBattleActive = false;
      autoBattleBtn.textContent = '🤖 Auto Battle';
      autoBattleBtn.classList.remove('active');
    } else if (autoBattleActive) {
      triggerAutoMove();
    }
  }, 2200);
}

function showPromotion(piece) {
  const color = FACTION_COLORS[piece.faction];
  const names = { queen: 'Dame', rook: 'Turm', bishop: 'Läufer', knight: 'Springer' };
  const symbols = { queen: '♛', rook: '♜', bishop: '♝', knight: '♞' };

  promotionOverlay.innerHTML = `
    <div class="promotion-box">
      <div class="promotion-title" style="color:${color.primary}">
        Bauer promoviert! Wähle eine Figur:
      </div>
      <div class="promotion-choices">
        ${PROMOTION_CHOICES.map(type => `
          <button class="promotion-choice" data-type="${type}" style="border-color:${color.primary}">
            <span class="choice-symbol">${symbols[type]}</span>
            <span class="choice-name">${names[type]}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
  promotionOverlay.classList.add('visible');

  promotionOverlay.querySelectorAll('.promotion-choice').forEach(btn => {
    btn.addEventListener('click', () => {
      const newType = btn.dataset.type;
      promotionOverlay.classList.remove('visible');
      const result = game.completePromotion(newType);
      if (result) {
        addToLog(result);
        // Re-render the promoted piece
        renderer.removePiece(piece.id);
        renderer.renderPiece(piece);
        updateUI();
        sounds.playPromotion();
      }
    });
  });
}

autoBattleBtn.addEventListener('click', () => {
  if (game.state === GAME_STATE.GAME_OVER) return;
  autoBattleActive = !autoBattleActive;
  if (autoBattleActive) {
    autoBattleBtn.textContent = '⏹ Auto Battle Stoppen';
    autoBattleBtn.classList.add('active');
    triggerAutoMove();
  } else {
    autoBattleBtn.textContent = '🤖 Auto Battle';
    autoBattleBtn.classList.remove('active');
    clearTimeout(autoBattleTimer);
  }
});

const undoBtn = document.getElementById('undo-btn');
undoBtn.addEventListener('click', () => {
  const snap = game.undo();
  if (snap) {
    updateUI();
  }
});
 
rpsToggle.addEventListener('change', (e) => {
  game.rpsEnabled = e.target.checked;
  updateUI();
});

soundToggle.addEventListener('change', (e) => {
  sounds.toggle(e.target.checked);
});

// AI Difficulty Slider
const depthSlider = document.getElementById('depth-slider');
const depthLabel = document.getElementById('depth-label');
const depthNames = { 1: 'Leicht', 2: 'Mittel', 3: 'Schwer', 4: 'Extrem' };
depthSlider.addEventListener('input', (e) => {
  const depth = parseInt(e.target.value);
  setAIDepth(depth);
  depthLabel.textContent = 'KI: ' + depthNames[depth];
});

let currentBoardRotation = 0;
rotateBtn.addEventListener('click', () => {
  currentBoardRotation += 120;
  renderer.setRotation(currentBoardRotation);
});

restartBtn.addEventListener('click', () => {
  combatOverlay.classList.remove('visible');
  promotionOverlay.classList.remove('visible');
  const boardGroup = document.getElementById('board-group');
  boardGroup.querySelectorAll('.piece').forEach(el => el.remove());
  renderer.pieceElements.clear();
  game.init(renderer.cells);
  game._undoStack = [];
  moveLogEl.innerHTML = '';
  for (const p of game.getAlivePieces()) renderer.renderPiece(p);
  for (const fac of [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]) {
    const el = document.getElementById(`panel-${fac}`);
    if (el) el.classList.remove('eliminated');
  }
  
  autoBattleActive = false;
  autoBattleBtn.textContent = '🤖 Auto Battle';
  autoBattleBtn.classList.remove('active');
  clearTimeout(autoBattleTimer);
  
  updateUI();
});

init();

export { game, renderer, triggerAutoMove };
