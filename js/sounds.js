/**
 * SoundManager - Synthesizes game sounds using the Web Audio API.
 */
class SoundManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  _init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  _playTone(freq, type, duration, volume, slide = 0) {
    if (!this.enabled) return;
    this._init();

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    if (slide !== 0) {
      osc.frequency.exponentialRampToValueAtTime(
        freq + slide,
        this.ctx.currentTime + duration,
      );
    }

    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.01,
      this.ctx.currentTime + duration,
    );

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  playSelect() {
    this._playTone(600, "sine", 0.1, 0.1);
  }

  playMove() {
    this._playTone(400, "triangle", 0.2, 0.1, -200);
  }

  playCombat() {
    // Noise-like impact
    this._playTone(150, "sawtooth", 0.3, 0.15, -100);
    setTimeout(() => this._playTone(100, "sine", 0.4, 0.2), 50);
  }

  playElimination() {
    this._playTone(300, "square", 0.5, 0.1, -150);
    setTimeout(() => this._playTone(200, "square", 0.6, 0.1, -100), 200);
  }

  playWin() {
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((f, i) => {
      setTimeout(() => this._playTone(f, "sine", 0.4, 0.1), i * 150);
    });
  }

  playCheck() {
    this._playTone(800, "square", 0.15, 0.08);
    setTimeout(() => this._playTone(600, "square", 0.15, 0.08), 100);
    setTimeout(() => this._playTone(400, "square", 0.2, 0.1), 200);
  }

  playStalemate() {
    const notes = [400, 350, 300, 250];
    notes.forEach((f, i) => {
      setTimeout(() => this._playTone(f, "triangle", 0.3, 0.08), i * 200);
    });
  }

  playTick() {
    this._playTone(1200, "sine", 0.05, 0.03);
  }

  playAIThinking() {
    this._playTone(200, "sine", 0.08, 0.02);
  }

  playPromotion() {
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 – shorter triumphant arpeggio
    notes.forEach((f, i) => {
      setTimeout(() => this._playTone(f, "sine", 0.3, 0.12), i * 100);
    });
  }

  toggle(val) {
    this.enabled = val;
  }
}

export const sounds = new SoundManager();
