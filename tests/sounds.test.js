import { expect, test, describe, vi, beforeEach } from "vitest";
import { sounds } from "../js/sounds.js";

describe("Sound System", () => {
  beforeEach(() => {
    // Mock AudioContext
    const mockOsc = {
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      frequency: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      type: "sine",
    };
    const mockGain = {
      connect: vi.fn(),
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
    };

    globalThis.AudioContext = vi.fn().mockImplementation(() => ({
      createOscillator: () => mockOsc,
      createGain: () => mockGain,
      destination: {},
      currentTime: 100,
    }));

    // Reset sounds state
    sounds.ctx = null;
    sounds.enabled = true;
  });

  test("toggle enables/disables sounds", () => {
    sounds.toggle(true);
    expect(sounds.enabled).toBe(true);
    sounds.toggle(false);
    expect(sounds.enabled).toBe(false);
  });

  test("playSelect creates sound nodes", () => {
    sounds.playSelect();
    expect(globalThis.AudioContext).toHaveBeenCalled();
  });

  test("playMove creates sound nodes", () => {
    sounds.playMove();
    expect(globalThis.AudioContext).toHaveBeenCalled();
  });

  test("resumes AudioContext if suspended", () => {
    // Modify mock for this test
    const mockResume = vi.fn();
    globalThis.AudioContext = vi.fn().mockImplementation(() => ({
      createOscillator: () => ({
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        frequency: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        type: "sine",
      }),
      createGain: () => ({
        connect: vi.fn(),
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
      }),
      destination: {},
      currentTime: 100,
      state: "suspended",
      resume: mockResume,
    }));

    sounds.ctx = null; // force re-init
    sounds.playSelect();
    expect(mockResume).toHaveBeenCalled();
  });

  test("playCombat creates sound nodes", () => {
    sounds.playCombat();
    expect(globalThis.AudioContext).toHaveBeenCalled();
  });

  test("playElimination creates sound nodes", () => {
    sounds.playElimination();
    expect(globalThis.AudioContext).toHaveBeenCalled();
  });

  test("playWin creates sound nodes", () => {
    vi.useFakeTimers();
    sounds.playWin();
    vi.runAllTimers();
    expect(globalThis.AudioContext).toHaveBeenCalled();
    vi.useRealTimers();
  });

  test("playPromotion creates sound nodes", () => {
    vi.useFakeTimers();
    sounds.playPromotion();
    vi.runAllTimers();
    expect(globalThis.AudioContext).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
