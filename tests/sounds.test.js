import { expect, test, describe, vi, beforeEach } from 'vitest';
import { sounds } from '../js/sounds.js';

describe('Sound System', () => {
  beforeEach(() => {
    // Mock AudioContext
    const mockOsc = {
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      frequency: { 
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn()
      },
      type: 'sine'
    };
    const mockGain = {
      connect: vi.fn(),
      gain: { 
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn()
      }
    };
    
    global.AudioContext = vi.fn().mockImplementation(() => ({
      createOscillator: () => mockOsc,
      createGain: () => mockGain,
      destination: {},
      currentTime: 100
    }));
    
    // Reset sounds state
    sounds.ctx = null;
    sounds.enabled = true;
  });

  test('toggle enables/disables sounds', () => {
    sounds.toggle(true);
    expect(sounds.enabled).toBe(true);
    sounds.toggle(false);
    expect(sounds.enabled).toBe(false);
  });

  test('playMove creates sound nodes', () => {
    sounds.playMove();
    expect(global.AudioContext).toHaveBeenCalled();
  });

  test('playCombat creates sound nodes', () => {
    sounds.playCombat();
    expect(global.AudioContext).toHaveBeenCalled();
  });

  test('playElimination creates sound nodes', () => {
    sounds.playElimination();
    expect(global.AudioContext).toHaveBeenCalled();
  });

  test('playWin creates sound nodes', () => {
    vi.useFakeTimers();
    sounds.playWin();
    vi.runAllTimers();
    expect(global.AudioContext).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
