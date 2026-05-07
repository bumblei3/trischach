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
    if (this.ctx.state === 'suspended') {
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
      osc.frequency.exponentialRampToValueAtTime(freq + slide, this.ctx.currentTime + duration);
    }
    
    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  playSelect() {
    this._playTone(600, 'sine', 0.1, 0.1);
  }

  playMove() {
    this._playTone(400, 'triangle', 0.2, 0.1, -200);
  }

  playCombat() {
    // Noise-like impact
    this._playTone(150, 'sawtooth', 0.3, 0.15, -100);
    setTimeout(() => this._playTone(100, 'sine', 0.4, 0.2), 50);
  }

  playElimination() {
    const now = this.ctx ? this.ctx.currentTime : 0;
    this._playTone(300, 'square', 0.5, 0.1, -150);
    setTimeout(() => this._playTone(200, 'square', 0.6, 0.1, -100), 200);
  }

  playWin() {
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((f, i) => {
      setTimeout(() => this._playTone(f, 'sine', 0.4, 0.1), i * 150);
    });
  }

  toggle(val) {
    this.enabled = val;
  }
}

export const sounds = new SoundManager();
