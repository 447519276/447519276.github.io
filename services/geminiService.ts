import { GoogleGenAI, Type } from "@google/genai";
import { GameState, Player, Card, GamePhase } from "../types";

export interface BotDecision {
  action: 'FOLD' | 'CALL' | 'RAISE' | 'CHECK' | 'ALL_IN' | 'BET';
  raiseAmount?: number;
}

const formatCards = (cards: Card[]) => cards.map(c => `${c.display}${c.suit}`).join(',');

export const getBotDecision = async (
  gameState: GameState,
  bot: Player
): Promise<BotDecision> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const callAmount = gameState.currentHighBet - bot.currentBet;
    
    const prompt = `
      You are a professional Texas Hold'em Poker bot named ${bot.name}.
      Play rationally and aggressively with strong hands, fold weak hands early.
      
      Game State:
      - Phase: ${gameState.phase}
      - Your Chips: ${bot.chips}
      - Pot Size: ${gameState.pot}
      - Community Cards: [${formatCards(gameState.communityCards)}]
      - Your Hand: [${formatCards(bot.hand)}]
      - Current High Bet on Table: ${gameState.currentHighBet}
      - Your Current Bet in Round: ${bot.currentBet}
      - Cost to Call: ${callAmount}
      - Min Raise/Bet: ${gameState.minBet}
      
      Strategy:
      1. Pre-Flop: Raise with Pairs 88+, AK, AQ, AJ, KQ. Call with mid-pairs or connectors. Fold trash.
      2. Post-Flop: If you hit top pair or better, Bet/Raise. If you have a strong draw (flush/straight), Call or Semi-Bluff. If you missed completely, Check/Fold unless bluffing (rarely).
      3. Betting Rules:
         - If 'Cost to Call' is 0: You can CHECK or BET.
         - If 'Cost to Call' > 0: You can FOLD, CALL, or RAISE.
         - 'BET' means opening the betting when no one else has. 
         - 'RAISE' means increasing an existing bet.
      
      Output:
      - Return JSON ONLY.
      - action: "FOLD", "CALL", "CHECK", "BET", "RAISE", "ALL_IN"
      - raiseAmount: If BET or RAISE, the total amount you want your bet to be. Must be > Current High Bet.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            action: { type: Type.STRING, enum: ['FOLD', 'CALL', 'RAISE', 'CHECK', 'ALL_IN', 'BET'] },
            raiseAmount: { type: Type.INTEGER }
          },
          required: ['action']
        }
      }
    });
    
    if (response.text) {
        return JSON.parse(response.text) as BotDecision;
    }
    throw new Error("No response text");

  } catch (error: any) {
    // Quietly handle quota errors to keep the game flowing
    if (error.toString().includes('429') || error.toString().includes('quota')) {
        console.warn("Gemini Quota Exceeded. Using internal strategy.");
    } else {
        console.warn("Gemini API Error (using fallback):", error);
    }
    
    return getFallbackDecision(gameState, bot);
  }
};

// Robust deterministic fallback logic
const getFallbackDecision = (gameState: GameState, bot: Player): BotDecision => {
    const callAmount = gameState.currentHighBet - bot.currentBet;
    const r = Math.random();
    
    // 1. If we can Check (Cost to Call is 0)
    if (callAmount === 0) {
        // 20% chance to open betting with a min-bet if we have chips
        if (r > 0.8 && bot.chips >= gameState.minBet) {
             return { action: 'BET', raiseAmount: gameState.minBet };
        }
        return { action: 'CHECK' };
    } 
    
    // 2. Facing a Bet
    
    // Calculate Pot Odds (simplified)
    const potOdds = callAmount / (gameState.pot + callAmount);
    
    // If it's a huge bet (> 50% of our stack), fold most of the time unless we feel lucky
    if (callAmount > bot.chips * 0.5) {
        if (r > 0.9) return { action: 'ALL_IN' }; // 10% yolo
        return { action: 'FOLD' };
    }
    
    // If we don't have enough to call, All-In or Fold
    if (bot.chips <= callAmount) {
         if (r > 0.4) return { action: 'ALL_IN' };
         return { action: 'FOLD' };
    }

    // Standard Play:
    // 50% Call
    // 40% Fold
    // 10% Raise
    
    if (r < 0.4) return { action: 'FOLD' };
    if (r < 0.9) return { action: 'CALL' };
    
    // Attempt Raise
    // Rule: Min raise is current bet * 2
    const minRaise = gameState.currentHighBet > 0 ? gameState.currentHighBet * 2 : gameState.minBet;
    
    // Check if we have chips to raise
    const costToRaise = minRaise - bot.currentBet;
    
    if (bot.chips >= costToRaise) {
        return { action: 'RAISE', raiseAmount: minRaise };
    }
    
    return { action: 'CALL' };
};