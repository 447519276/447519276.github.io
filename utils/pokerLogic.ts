import { Card, Suit, HandRank } from '../types';

export const createDeck = (): Card[] => {
  const suits = [Suit.HEARTS, Suit.DIAMONDS, Suit.CLUBS, Suit.SPADES];
  const deck: Card[] = [];
  
  for (const suit of suits) {
    for (let r = 2; r <= 14; r++) {
      let display = String(r);
      if (r === 11) display = 'J';
      if (r === 12) display = 'Q';
      if (r === 13) display = 'K';
      if (r === 14) display = 'A';
      deck.push({ suit, rank: r, display });
    }
  }
  return deck;
};

export const shuffleDeck = (deck: Card[]): Card[] => {
  const newDeck = [...deck];
  for (let i = newDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
  }
  return newDeck;
};

// Simplified Hand Evaluator
export const evaluateHand = (holeCards: Card[], communityCards: Card[]): HandRank => {
  const allCards = [...holeCards, ...communityCards].sort((a, b) => b.rank - a.rank);
  
  // Helpers
  const getCounts = (cards: Card[]) => {
    const counts: Record<number, number> = {};
    cards.forEach(c => counts[c.rank] = (counts[c.rank] || 0) + 1);
    return counts;
  };
  
  const getSuits = (cards: Card[]) => {
    const counts: Record<string, number> = {};
    cards.forEach(c => counts[c.suit] = (counts[c.suit] || 0) + 1);
    return counts;
  };

  // Returns the high rank of the straight, or 0
  const getStraightHighRank = (ranks: number[]) => {
    const unique = Array.from(new Set(ranks)).sort((a, b) => b - a);
    if (unique.length < 5) return 0;
    
    // Check normal straights
    for (let i = 0; i <= unique.length - 5; i++) {
        if (unique[i] - unique[i+4] === 4) return unique[i];
    }
    // Wheel (A-5)
    if (unique.includes(14) && unique.includes(2) && unique.includes(3) && unique.includes(4) && unique.includes(5)) {
        return 5;
    }
    return 0;
  };

  // Construct the specific cards for a straight
  const getStraightCards = (allCards: Card[], highRank: number): Card[] => {
      const straightCards: Card[] = [];
      // Handle Wheel (5-high)
      if (highRank === 5) {
          const ranksNeeded = [5, 4, 3, 2, 14]; // 14 is Ace
          for (const r of ranksNeeded) {
              const card = allCards.find(c => c.rank === r);
              if (card) straightCards.push(card);
          }
      } else {
          for (let i = 0; i < 5; i++) {
              const r = highRank - i;
              const card = allCards.find(c => c.rank === r);
              if (card) straightCards.push(card);
          }
      }
      return straightCards;
  };

  const counts = getCounts(allCards);
  const suitCounts = getSuits(allCards);
  const ranks = allCards.map(c => c.rank);

  // Helper to get cards by rank
  const getByRank = (r: number) => allCards.filter(c => c.rank === r);
  const getExcluding = (excludedRanks: number[]) => allCards.filter(c => !excludedRanks.includes(c.rank));

  // Check Flush
  let flushSuit: string | null = null;
  for (const s in suitCounts) {
    if (suitCounts[s] >= 5) flushSuit = s;
  }
  
  const flushCards = flushSuit ? allCards.filter(c => c.suit === flushSuit) : [];
  
  // Check Straight Flush
  if (flushSuit) {
    const flushRanks = flushCards.map(c => c.rank);
    const sfHigh = getStraightHighRank(flushRanks);
    if (sfHigh) {
        const sfCards = getStraightCards(flushCards, sfHigh);
        return { score: 800 + sfHigh, name: 'Straight Flush', cards: sfCards };
    }
  }

  // Check Quads
  for (const r in counts) {
      if (counts[r] === 4) {
          const quadRank = Number(r);
          const quads = getByRank(quadRank);
          const kicker = getExcluding([quadRank])[0];
          return { score: 700 + quadRank, name: `Four of a Kind (${quadRank}'s)`, cards: [...quads, kicker] };
      }
  }

  // Check Full House
  const trips = Object.keys(counts).filter(r => counts[Number(r)] === 3).map(Number).sort((a, b) => b - a);
  const pairs = Object.keys(counts).filter(r => counts[Number(r)] === 2).map(Number).sort((a, b) => b - a);
  
  if (trips.length > 0) {
      const highTrip = trips[0];
      // Check for second trip (treated as pair) or pair
      const remaining = [...trips.filter(t => t !== highTrip), ...pairs].sort((a,b) => b-a);
      if (remaining.length > 0) {
          const highPair = remaining[0];
          const tripCards = getByRank(highTrip);
          const pairCards = getByRank(highPair).slice(0, 2);
          return { score: 600 + highTrip, name: `Full House (${highTrip}'s over ${highPair}'s)`, cards: [...tripCards, ...pairCards] };
      }
  }

  // Check Flush (Score)
  if (flushSuit) {
      return { score: 500 + flushCards[0].rank, name: 'Flush', cards: flushCards.slice(0,5) };
  }

  // Check Straight
  const straightHigh = getStraightHighRank(ranks);
  if (straightHigh) {
      const straightCards = getStraightCards(allCards, straightHigh);
      return { score: 400 + straightHigh, name: 'Straight', cards: straightCards };
  }

  // Check Trips
  if (trips.length > 0) {
      const tripRank = trips[0];
      const tripCards = getByRank(tripRank);
      const kickers = getExcluding([tripRank]).slice(0, 2);
      return { score: 300 + tripRank, name: `Three of a Kind (${tripRank}'s)`, cards: [...tripCards, ...kickers] };
  }

  // Check Two Pair
  if (pairs.length >= 2) {
      const p1 = pairs[0];
      const p2 = pairs[1];
      const p1Cards = getByRank(p1);
      const p2Cards = getByRank(p2);
      const kicker = getExcluding([p1, p2])[0];
      return { score: 200 + p1, name: `Two Pair (${p1}'s and ${p2}'s)`, cards: [...p1Cards, ...p2Cards, kicker] };
  }

  // Check Pair
  if (pairs.length === 1) {
      const p1 = pairs[0];
      const p1Cards = getByRank(p1);
      const kickers = getExcluding([p1]).slice(0, 3);
      return { score: 100 + p1, name: `Pair of ${p1}'s`, cards: [...p1Cards, ...kickers] };
  }

  // High Card
  return { score: ranks[0], name: `High Card (${ranks[0]})`, cards: allCards.slice(0,5) };
};