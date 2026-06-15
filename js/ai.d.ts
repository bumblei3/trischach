// Type declarations for JS modules without TS counterparts

// ai.js - AI functions exported for main thread
export function calculateBestMove(game: any, faction: string): any;
export function evaluateBoard(game: any, faction: string): number;
export function setAIDepth(depth: number): void;
export function setAIPersonality(personality: string): void;
export function getAIPersonalities(): any[];
export function buildOpeningBook(GameClass: any): void;
export function startPondering(game: any, faction: string): void;
export function stopPondering(): Promise<any>;
export function isPondering(): boolean;

// Re-export types from ai-core
export type { AIAction, SearchResult, TranspositionEntry } from "./ai-core.ts";
export type {
  AIPersonality,
  PersonalityWeights,
  PersonalityConfig,
} from "./types.ts";
export { AI_PERSONALITIES } from "./types.ts";
