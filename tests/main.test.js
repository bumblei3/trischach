import { expect, test, describe, beforeEach, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Read index.html to inject into JSDOM
// eslint-disable-next-line no-undef
const htmlPath = path.resolve(__dirname, '../index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
let bodyHTML = bodyMatch ? bodyMatch[1] : htmlContent;
// Remove script tags to prevent HappyDOM from trying to fetch them
bodyHTML = bodyHTML.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

describe('Main UI & Events', () => {
  beforeEach(() => {
    document.body.innerHTML = bodyHTML;
    vi.resetModules(); // Ensure main.js runs cleanly each time
    
    // Mock AudioContext
    globalThis.AudioContext = vi.fn().mockImplementation(() => ({
      createOscillator: () => ({ connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, type: 'sine' }),
      createGain: () => ({ connect: vi.fn(), gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() } }),
      destination: {},
      currentTime: 100
    }));
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  test('UI initializes correctly on load', async () => {
    await import('../js/main.js');
    
    const svg = document.getElementById('board-svg');
    expect(svg.querySelectorAll('.hex-polygon').length).toBeGreaterThan(0);
    
    const turnEl = document.getElementById('turn-indicator');
    expect(turnEl.textContent).toContain('Feuer'); 
  });

  test('Board rotate button applies rotation', async () => {
    await import('../js/main.js');
    const rotateBtn = document.getElementById('rotate-btn');
    const svg = document.getElementById('board-svg');
    
    rotateBtn.click();
    expect(svg.style.transform).toBe('rotate(120deg)');
    rotateBtn.click();
    expect(svg.style.transform).toBe('rotate(240deg)');
  });

  test('Auto Battle toggle button', async () => {
    vi.useFakeTimers();
    await import('../js/main.js');
    const autoBattleBtn = document.getElementById('auto-battle-btn');
    
    autoBattleBtn.click();
    expect(autoBattleBtn.classList.contains('active')).toBe(true);
    
    vi.advanceTimersByTime(500);
    
    autoBattleBtn.click();
    expect(autoBattleBtn.classList.contains('active')).toBe(false);
    vi.useRealTimers();
  });

  test('Restart button resets the game', async () => {
    await import('../js/main.js');
    const restartBtn = document.getElementById('restart-btn');
    const moveLogEl = document.getElementById('move-log');
    
    moveLogEl.innerHTML = '<div>Fake Move</div>';
    restartBtn.click();
    
    expect(moveLogEl.innerHTML).toBe('');
    const statusEl = document.getElementById('status');
    expect(statusEl.textContent).toBe('Wähle eine Figur');
  });

  test('Toggles for RPS and Sound', async () => {
    await import('../js/main.js');
    const rpsToggle = document.getElementById('rps-toggle');
    const soundToggle = document.getElementById('sound-toggle');
    const rpsInfoEl = document.getElementById('rps-info');
    
    rpsToggle.checked = false;
    rpsToggle.dispatchEvent(new Event('change'));
    expect(rpsInfoEl.classList.contains('rps-inactive')).toBe(true);
    
    soundToggle.checked = false;
    soundToggle.dispatchEvent(new Event('change'));
  });

  test('Simulate gameplay clicks (move and combat)', async () => {
    vi.useFakeTimers();
    await import('../js/main.js');
    const pieces = document.querySelectorAll('.piece');
    expect(pieces.length).toBeGreaterThan(0);
    
    // Auto Battle triggers a move and potentially combat
    const autoBattleBtn = document.getElementById('auto-battle-btn');
    autoBattleBtn.click();
    
    // Fast forward to trigger AI move
    vi.advanceTimersByTime(500); 
    
    // If it was a combat, the overlay should be visible
    const combatOverlay = document.getElementById('combat-overlay');
    if (combatOverlay.classList.contains('visible')) {
      const stopBtn = document.getElementById('stop-auto-combat');
      if (stopBtn) stopBtn.click(); // Stop auto battle during combat
      
      // Fast forward past combat animation
      vi.advanceTimersByTime(2500);
      expect(combatOverlay.classList.contains('visible')).toBe(false);
    }
    
    vi.useRealTimers();
  });
});
