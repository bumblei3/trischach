// Type declarations for sounds.js

export interface Sounds {
  toggle(enabled: boolean): void;
  playSelect(): void;
  playMove(): void;
  playCombat(): void;
  playCheck(): void;
  playPromotion(): void;
  playWin(): void;
  playElimination(): void;
  playStalemate(): void;
  playError(): void;
}

export const sounds: Sounds;