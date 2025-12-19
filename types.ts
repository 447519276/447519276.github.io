export enum Suit {
  HEARTS = '♥',
  DIAMONDS = '♦',
  CLUBS = '♣',
  SPADES = '♠'
}

export interface Card {
  suit: Suit;
  rank: number; // 2-14 (11=J, 12=Q, 13=K, 14=A)
  display: string;
}

export enum PlayerRole {
  USER = 'USER',
  BOT = 'BOT'
}

export enum PlayerStatus {
  ACTIVE = 'ACTIVE', // Still in the hand
  FOLDED = 'FOLDED', // Folded this hand
  ALL_IN = 'ALL_IN', // Bet everything
  BUSTED = 'BUSTED' // Out of the game (0 chips)
}

export interface Player {
  id: number;
  name: string;
  role: PlayerRole;
  chips: number;
  hand: Card[];
  status: PlayerStatus;
  currentBet: number; // Amount bet in the current betting round
  totalHandBet: number; // Total amount bet in this hand
  lastAction?: string;
}

export enum GamePhase {
  PRE_FLOP = 'Pre-Flop',
  FLOP = 'Flop',
  TURN = 'Turn',
  RIVER = 'River',
  SHOWDOWN = 'Showdown',
  GAME_OVER = 'Game Over'
}

export interface ShowdownResult {
  playerId: number;
  name: string;
  role: PlayerRole;
  handDescription: string;
  holeCards: Card[];
  winningCards: Card[]; // The best 5 cards
  amount: number; // Win amount (0 if lost)
  isWinner: boolean;
  score: number;
}

export interface GameState {
  players: Player[];
  pot: number;
  deck: Card[];
  communityCards: Card[];
  dealerIndex: number;
  activePlayerIndex: number;
  currentHighBet: number;
  phase: GamePhase;
  isGameRunning: boolean;
  minBet: number; // Big Blind
  smallBlindIndex: number;
  bigBlindIndex: number;
  showdownResults: ShowdownResult[];
  message: string;
}

export interface HandRank {
  score: number;
  name: string;
  cards: Card[];
}