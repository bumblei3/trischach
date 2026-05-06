import { BoardRenderer, FACTION_COLORS, FACTION, getRPSResult } from './board.js';
import { Game, GAME_STATE } from './game.js';
import { calculateBestMove } from './ai.js';

const svg = document.getElementById('board-svg');
const statusEl = document.getElementById('status');
const turnEl = document.getElementById('turn-indicator');
const rpsInfoEl = document.getElementById('rps-info');
const combatOverlay = document.getElementById('combat-overlay');
const restartBtn = document.getElementById('restart-btn');
const autoBattleBtn = document.getElementById('auto-battle-btn');

const renderer = new BoardRenderer(svg);
const game = new Game();

let autoBattleActive = false;
let autoBattleTimer = null;

function init() {
  renderer.render();
  game.init(renderer.cells);
  // Render all pieces
  for (const p of game.getAlivePieces()) renderer.renderPiece(p);
  updateUI();
}

function updateUI() {
  const f = game.currentFaction;
  const fc = FACTION_COLORS[f];
  turnEl.textContent = fc.name;
  turnEl.style.color = fc.primary;
  statusEl.textContent = game.state === GAME_STATE.SELECT_PIECE
    ? 'Wähle eine Figur'
    : 'Wähle ein Ziel';
  // Update eliminated indicators
  for (const fac of [FACTION.FIRE, FACTION.WATER, FACTION.NATURE]) {
    const el = document.getElementById(`panel-${fac}`);
    if (el && game.eliminatedFactions.has(fac)) el.classList.add('eliminated');
  }
}

renderer.onCellClick = (hex, cell) => {
  const result = game.handleCellClick(hex);
  if (!result) return;

  renderer.clearHighlights();
  renderer.clearSelection();

  if (result.action === 'select') {
    renderer.selectCell(hex);
    renderer.highlightCells(result.moves, 'highlight-move');
    renderer.highlightCells(result.attacks, 'highlight-attack');
  } else if (result.action === 'deselect') {
    // nothing
  } else if (result.action === 'move') {
    renderer.renderPiece(result.piece);
    updateUI();
  } else if (result.action === 'combat') {
    showCombat(result);
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

    const action = calculateBestMove(game, game.currentFaction);
    
    if (action) {
      // Execute the action programmatically
      game.handleCellClick(action.piece.pos); // Select piece
      const result = game.handleCellClick(action.target); // Execute move/attack
      
      renderer.clearHighlights();
      renderer.clearSelection();
      
      if (result && result.action === 'move') {
        renderer.renderPiece(result.piece);
        updateUI();
        triggerAutoMove(); // Queue next move
      } else if (result && result.action === 'combat') {
        showCombat(result);
        // showCombat will trigger the next auto move after animation
      }
    } else {
      // No valid moves? Skip turn or game over.
      game.state = GAME_STATE.GAME_OVER;
      updateUI();
    }
  }, 400); // 400ms delay between AI moves
}

function showCombat(result) {
  const attColor = FACTION_COLORS[result.piece.faction];
  const defColor = FACTION_COLORS[result.defender.faction];
  const rps = result.rpsResult;

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
      ${result.gameOver ? `<div class="combat-winner">🏆 ${FACTION_COLORS[result.winner_faction].name} gewinnt!</div>` : ''}
    </div>
  `;
  combatOverlay.classList.add('visible');

  setTimeout(() => {
    combatOverlay.classList.remove('visible');
    // Re-render pieces
    const boardGroup = document.getElementById('board-group');
    boardGroup.querySelectorAll('.piece').forEach(el => el.remove());
    renderer.pieceElements.clear();
    for (const p of game.getAlivePieces()) renderer.renderPiece(p);
    updateUI();
    if (result.gameOver) {
      statusEl.textContent = `🏆 ${FACTION_COLORS[result.winner_faction].name} hat gewonnen!`;
      autoBattleActive = false;
      autoBattleBtn.textContent = '🤖 Auto Battle';
      autoBattleBtn.classList.remove('active');
    } else if (autoBattleActive) {
      triggerAutoMove();
    }
  }, 2200);
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

restartBtn.addEventListener('click', () => {
  combatOverlay.classList.remove('visible');
  const boardGroup = document.getElementById('board-group');
  boardGroup.querySelectorAll('.piece').forEach(el => el.remove());
  renderer.pieceElements.clear();
  game.init(renderer.cells);
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
