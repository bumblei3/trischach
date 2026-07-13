/**
 * SoundManager - Synthesizes game sounds using the Web Audio API.
 */

export class SoundManager {
  private ctx: AudioContext | null;
  private enabled: boolean;

  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  private _init(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (
          window as unknown as {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  private _playTone(
    freq: number,
    type: OscillatorType,
    duration: number,
    volume: number,
    slide = 0,
  ): void {
    if (!this.enabled) return;
    this._init();

    const ctx = this.ctx;
    if (!ctx) return;
    // Guard against environments (or test mocks) where the AudioContext
    // exists but lacks the Web Audio API surface (e.g. headless CI).
    if (typeof ctx.createOscillator !== "function") return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slide !== 0) {
      osc.frequency.exponentialRampToValueAtTime(
        freq + slide,
        ctx.currentTime + duration,
      );
    }

    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  playSelect(): void {
    this._playTone(600, "sine", 0.1, 0.1);
  }

  playMove(): void {
    this._playTone(400, "triangle", 0.2, 0.1, -200);
  }

  playCombat(): void {
    // Noise-like impact
    this._playTone(150, "sawtooth", 0.3, 0.15, -100);
    setTimeout(() => this._playTone(100, "sine", 0.4, 0.2), 50);
  }

  playElimination(): void {
    this._playTone(300, "square", 0.5, 0.1, -150);
    setTimeout(() => this._playTone(200, "square", 0.6, 0.1, -100), 200);
  }

  playWin(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((f, i) => {
      setTimeout(() => this._playTone(f, "sine", 0.4, 0.1), i * 150);
    });
  }

  playCheck(): void {
    this._playTone(800, "square", 0.15, 0.08);
    setTimeout(() => this._playTone(600, "square", 0.15, 0.08), 100);
    setTimeout(() => this._playTone(400, "square", 0.2, 0.1), 200);
  }

  playStalemate(): void {
    const notes = [400, 350, 300, 250];
    notes.forEach((f, i) => {
      setTimeout(() => this._playTone(f, "triangle", 0.3, 0.08), i * 200);
    });
  }

  playTick(): void {
    this._playTone(1200, "sine", 0.05, 0.03);
  }

  playAIThinking(): void {
    this._playTone(200, "sine", 0.08, 0.02);
  }

  playPromotion(): void {
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 – shorter triumphant arpeggio
    notes.forEach((f, i) => {
      setTimeout(() => this._playTone(f, "sine", 0.3, 0.12), i * 100);
    });
  }

  playError(): void {
    this._playTone(220, "square", 0.15, 0.1, -40);
    setTimeout(() => this._playTone(180, "square", 0.2, 0.1, -30), 80);
  }

  toggle(val: boolean): void {
    this.enabled = val;
  }
}

export const sounds = new SoundManager();
