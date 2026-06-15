// Type declarations for replay.js

export interface TSPNMove {
  turn: number;
  faction: string;
  pieceId: string;
  pieceType: string;
  from: [number, number];
  to: [number, number];
  action: "move" | "combat" | "promotion";
  rpsResult?: string;
  promotionTo?: string;
}

export interface TSPNCapturedPiece {
  id: string;
  type: string;
  faction: string;
}

export interface TSPNState {
  pieces: Array<{
    id: string;
    type: string;
    faction: string;
    pos: [number, number];
    symbol: string;
    alive: boolean;
    hasMoved: boolean;
  }>;
  moveHistory: TSPNMove[];
  capturedPieces: {
    fire: string[];
    water: string[];
    nature: string[];
  };
  eliminatedFactions: string[];
  currentFaction: string;
  currentFactionIdx: number;
  state: string;
  halfmoveClock: number;
}

export interface ParsedTSPN {
  headers: Record<string, string>;
  moves: TSPNMove[];
  initialState: TSPNState;
}

export function serializeGame(game: any): string;
export function downloadGame(game: any, filename: string): void;
export function copyGameToClipboard(game: any): Promise<void>;
export function loadGameFromFile(file: File): Promise<ParsedTSPN>;
export function parseTSPN(text: string): ParsedTSPN;
export function reconstructGameFromTSPN(
  parsed: ParsedTSPN,
  GameClass: any,
  cells: Map<string, any>
): { game: any; controller: ReplayController };

export class ReplayController {
  constructor(parsed: ParsedTSPN, GameClass: any, cells: Map<string, any>);
  getCurrentState(): any;
  getCurrentMoveNumber(): number;
  getTotalMoves(): number;
  canGoForward(): boolean;
  canGoBack(): boolean;
  next(): void;
  previous(): void;
  goToStart(): void;
  goToEnd(): void;
  exportTSPN(): string;
}