import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GameState, Player, PlayerRole, PlayerStatus, GamePhase, Card, Suit, ShowdownResult } from './types';
import { createDeck, shuffleDeck, evaluateHand } from './utils/pokerLogic';
import { PlayerSeat } from './components/PlayerSeat';
import { CardComponent } from './components/CardComponent';
import { Controls } from './components/Controls';
import { getBotDecision } from './services/geminiService';

// Constants
const TOTAL_PLAYERS = 9;
const INITIAL_BIG_BLIND = 20;
const INITIAL_SMALL_BLIND = 10;
const DELAY_MS = 600; // Faster bot actions

const App: React.FC = () => {
  // -------------------------------------------------------------------------
  // State Initialization
  // -------------------------------------------------------------------------
  const [setupMode, setSetupMode] = useState(true);
  const [buyIn, setBuyIn] = useState(1000);
  
  const [gameState, setGameState] = useState<GameState>({
    players: [],
    pot: 0,
    deck: [],
    communityCards: [],
    dealerIndex: 0,
    activePlayerIndex: -1,
    currentHighBet: 0,
    phase: GamePhase.PRE_FLOP,
    isGameRunning: false,
    minBet: INITIAL_BIG_BLIND,
    smallBlindIndex: 0,
    bigBlindIndex: 0,
    showdownResults: [],
    message: "Welcome to Gemini Poker"
  });

  const gameStateRef = useRef(gameState); // Ref to access latest state in async/timers

  // Sync ref
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  const addMessage = (msg: string) => {
    setGameState(prev => ({ ...prev, message: msg }));
  };

  const getNextActivePlayer = (startIndex: number, players: Player[]): number => {
    let count = 0;
    let idx = startIndex;
    while (count < players.length) {
      idx = (idx + 1) % players.length;
      if (players[idx].status === PlayerStatus.ACTIVE || (players[idx].status === PlayerStatus.ALL_IN && players[idx].currentBet < gameStateRef.current.currentHighBet)) {
        if (players[idx].status === PlayerStatus.ACTIVE) return idx;
      }
      count++;
    }
    return -1; // No active players left to act
  };

  // -------------------------------------------------------------------------
  // Game Setup
  // -------------------------------------------------------------------------
  const startGame = () => {
    const players: Player[] = [];
    const userIndex = Math.floor(Math.random() * TOTAL_PLAYERS); // Random seat

    for (let i = 0; i < TOTAL_PLAYERS; i++) {
      players.push({
        id: i,
        name: i === userIndex ? "You" : `Bot ${i + 1}`,
        role: i === userIndex ? PlayerRole.USER : PlayerRole.BOT,
        chips: buyIn,
        hand: [],
        status: PlayerStatus.ACTIVE,
        currentBet: 0,
        totalHandBet: 0
      });
    }

    setSetupMode(false);
    startNewHand(players, 0); // Start with dealer at 0
  };

  const quitGame = () => {
    setSetupMode(true);
    setGameState(prev => ({ ...prev, isGameRunning: false }));
  };

  const startNewHand = (currentPlayers: Player[], dealerIdx: number) => {
    // 1. Reset statuses based on chips
    // Any player with 0 chips is BUSTED.
    // Any player with > 0 chips is ACTIVE (even if they were folded or all-in previously)
    const players = currentPlayers.map(p => ({
        ...p,
        status: p.chips > 0 ? PlayerStatus.ACTIVE : PlayerStatus.BUSTED,
        hand: [],
        currentBet: 0,
        lastAction: undefined,
        totalHandBet: 0
    }));

    // 2. Check Victory/Defeat Conditions
    const user = players.find(p => p.role === PlayerRole.USER);
    const activeBots = players.filter(p => p.role === PlayerRole.BOT && p.status === PlayerStatus.ACTIVE);
    
    let isGameOver = false;
    let gameOverMsg = "";

    // If user is busted, Game Over (Defeat)
    if (!user || user.status === PlayerStatus.BUSTED) {
         isGameOver = true;
         gameOverMsg = "You have been eliminated.";
    } 
    // If user is active but no bots are active, Game Over (Victory)
    else if (activeBots.length === 0) {
         isGameOver = true;
         gameOverMsg = "You are the Champion!";
    }

    if (isGameOver) {
         setGameState(prev => ({ 
            ...prev, 
            players, 
            isGameRunning: false, 
            phase: GamePhase.GAME_OVER,
            message: gameOverMsg
        }));
        return;
    }

    // Reset deck
    const deck = shuffleDeck(createDeck());

    // Deal hole cards
    for (const p of players) {
        if (p.status === PlayerStatus.ACTIVE) {
            p.hand = [deck.pop()!, deck.pop()!];
        }
    }

    // Blinds
    // Find next active player after dealer for SB
    let sbIndex = (dealerIdx + 1) % TOTAL_PLAYERS;
    while(players[sbIndex].status === PlayerStatus.BUSTED) sbIndex = (sbIndex + 1) % TOTAL_PLAYERS;
    
    let bbIndex = (sbIndex + 1) % TOTAL_PLAYERS;
    while(players[bbIndex].status === PlayerStatus.BUSTED) bbIndex = (bbIndex + 1) % TOTAL_PLAYERS;

    // Apply Blinds
    const sbAmount = Math.min(INITIAL_SMALL_BLIND, players[sbIndex].chips);
    players[sbIndex].chips -= sbAmount;
    players[sbIndex].currentBet = sbAmount;
    players[sbIndex].totalHandBet = sbAmount;
    if (players[sbIndex].chips === 0) players[sbIndex].status = PlayerStatus.ALL_IN;

    const bbAmount = Math.min(INITIAL_BIG_BLIND, players[bbIndex].chips);
    players[bbIndex].chips -= bbAmount;
    players[bbIndex].currentBet = bbAmount;
    players[bbIndex].totalHandBet = bbAmount;
    if (players[bbIndex].chips === 0) players[bbIndex].status = PlayerStatus.ALL_IN;

    // First to act is after Big Blind
    let firstActionIndex = (bbIndex + 1) % TOTAL_PLAYERS;
    while(players[firstActionIndex].status === PlayerStatus.BUSTED) firstActionIndex = (firstActionIndex + 1) % TOTAL_PLAYERS;

    setGameState({
        players,
        pot: sbAmount + bbAmount,
        deck,
        communityCards: [],
        dealerIndex: dealerIdx,
        activePlayerIndex: firstActionIndex,
        currentHighBet: INITIAL_BIG_BLIND,
        phase: GamePhase.PRE_FLOP,
        isGameRunning: true,
        minBet: INITIAL_BIG_BLIND,
        smallBlindIndex: sbIndex,
        bigBlindIndex: bbIndex,
        showdownResults: [],
        message: "New Hand! Pre-Flop."
    });
  };

  // -------------------------------------------------------------------------
  // Core Game Loop / Turn Management
  // -------------------------------------------------------------------------
  
  // Effect to trigger Bot Turns
  useEffect(() => {
    if (!gameState.isGameRunning) return;
    
    const currentPlayer = gameState.players[gameState.activePlayerIndex];
    if (!currentPlayer) return;

    if (currentPlayer.role === PlayerRole.BOT && currentPlayer.status === PlayerStatus.ACTIVE) {
        const timer = setTimeout(() => {
            handleBotTurn();
        }, DELAY_MS);
        return () => clearTimeout(timer);
    }
  }, [gameState.activePlayerIndex, gameState.phase, gameState.isGameRunning]);

  const handleBotTurn = async () => {
    const currentState = gameStateRef.current;
    const playerIdx = currentState.activePlayerIndex;
    const player = currentState.players[playerIdx];

    if (player.role !== PlayerRole.BOT || player.status !== PlayerStatus.ACTIVE) {
        advanceTurn();
        return;
    }

    try {
        const decision = await getBotDecision(currentState, player);
        executePlayerAction(playerIdx, decision.action, decision.raiseAmount);
    } catch (e) {
        console.error("Bot failed to think", e);
        executePlayerAction(playerIdx, 'FOLD');
    }
  };

  const executePlayerAction = (playerIndex: number, action: string, amount?: number) => {
    setGameState(prev => {
        const newPlayers = [...prev.players];
        const p = newPlayers[playerIndex];
        let newPot = prev.pot;
        let newHighBet = prev.currentHighBet;
        let msg = `${p.name} `;
        
        if (action === 'FOLD') {
            p.status = PlayerStatus.FOLDED;
            p.lastAction = 'Fold';
            msg += 'folded.';
        } else if (action === 'CHECK') {
            p.lastAction = 'Check';
            msg += 'checked.';
        } else if (action === 'CALL') {
            const callAmt = Math.min(p.chips, prev.currentHighBet - p.currentBet);
            p.chips -= callAmt;
            p.currentBet += callAmt;
            p.totalHandBet += callAmt;
            newPot += callAmt;
            if (p.chips === 0) p.status = PlayerStatus.ALL_IN;
            p.lastAction = 'Call';
            msg += 'called.';
        } else if (action === 'RAISE' || action === 'BET') {
            // Updated Rule: Min raise is Double the current high bet (or MinBet if 0)
            const minRaiseAbs = prev.currentHighBet > 0 ? prev.currentHighBet * 2 : prev.minBet;
            
            let raiseTo = amount || minRaiseAbs;
            
            // Validation
            const maxTotal = p.chips + p.currentBet;
            
            // If user goes ALL IN with less than min raise, we handle as ALL IN implicitly
            if (raiseTo > maxTotal) raiseTo = maxTotal;

            // Enforce Min Raise Rule (unless All-In)
            if (raiseTo < minRaiseAbs && raiseTo < maxTotal) {
                raiseTo = minRaiseAbs; 
            }

            const addedChips = raiseTo - p.currentBet;
            
            // Sanity check to prevent negative chips
            if (addedChips > p.chips) {
                 // Should ideally be All-In, but let's clamp
                 p.status = PlayerStatus.ALL_IN;
                 p.lastAction = 'All In';
                 msg += 'went All In!';
                 const actualAdd = p.chips;
                 p.chips = 0;
                 p.currentBet += actualAdd;
                 p.totalHandBet += actualAdd;
                 newPot += actualAdd;
                 if (p.currentBet > newHighBet) newHighBet = p.currentBet;
            } else {
                p.chips -= addedChips;
                p.currentBet = raiseTo;
                p.totalHandBet += addedChips;
                newPot += addedChips;
                
                if (raiseTo > newHighBet) newHighBet = raiseTo;
                if (p.chips === 0) p.status = PlayerStatus.ALL_IN;
                
                if (action === 'BET') {
                     p.lastAction = `Bet ${raiseTo}`;
                     msg += `bet ${raiseTo}.`;
                } else {
                     p.lastAction = `Raise to ${raiseTo}`;
                     msg += `raised to ${raiseTo}.`;
                }
            }
        } else if (action === 'ALL_IN') {
             const allInAmt = p.chips;
             p.chips = 0;
             const totalBet = p.currentBet + allInAmt;
             p.currentBet = totalBet;
             p.totalHandBet += allInAmt;
             newPot += allInAmt;
             p.status = PlayerStatus.ALL_IN;
             
             if (totalBet > newHighBet) newHighBet = totalBet;
             p.lastAction = 'All In';
             msg += 'went All In!';
        }

        return {
            ...prev,
            players: newPlayers,
            pot: newPot,
            currentHighBet: newHighBet,
            message: msg
        };
    });

    setTimeout(() => {
        advanceTurn();
    }, 400); // UI visual update delay
  };

  const advanceTurn = () => {
    const currentState = gameStateRef.current;
    
    const activePlayers = currentState.players.filter(p => p.status !== PlayerStatus.FOLDED && p.status !== PlayerStatus.BUSTED);
    const notAllIn = activePlayers.filter(p => p.status !== PlayerStatus.ALL_IN);
    
    // Check if only 1 player remains
    const nonFolded = currentState.players.filter(p => p.status !== PlayerStatus.FOLDED && p.status !== PlayerStatus.BUSTED);
    if (nonFolded.length === 1) {
        resolveWinner(nonFolded);
        return;
    }

    const allMatched = notAllIn.every(p => p.currentBet === currentState.currentHighBet);
    const everyoneActed = notAllIn.every(p => p.lastAction !== undefined);

    // If everyone is all in or matching bets
    if (activePlayers.length > 0 && (activePlayers.every(p => p.status === PlayerStatus.ALL_IN) || (notAllIn.length <= 1 && allMatched))) {
        nextPhase();
        return;
    }

    if (allMatched && everyoneActed) {
        nextPhase();
        return;
    }

    // Find next player
    let nextIdx = (currentState.activePlayerIndex + 1) % TOTAL_PLAYERS;
    let found = false;
    let loops = 0;
    while(loops < TOTAL_PLAYERS) {
        const p = currentState.players[nextIdx];
        if (p.status === PlayerStatus.ACTIVE) {
            found = true;
            break;
        }
        nextIdx = (nextIdx + 1) % TOTAL_PLAYERS;
        loops++;
    }

    if (found) {
        setGameState(prev => ({ ...prev, activePlayerIndex: nextIdx }));
    } else {
        nextPhase();
    }
  };

  const nextPhase = () => {
    const currentState = gameStateRef.current;
    
    // Reset bets for new round
    const updatedPlayers = currentState.players.map(p => ({
        ...p,
        currentBet: 0,
        lastAction: undefined 
    }));
    
    let nextPhaseEnum: GamePhase = GamePhase.PRE_FLOP;
    let nextCommCards = [...currentState.communityCards];
    const deck = [...currentState.deck];

    if (currentState.phase === GamePhase.PRE_FLOP) {
        nextPhaseEnum = GamePhase.FLOP;
        nextCommCards.push(deck.pop()!, deck.pop()!, deck.pop()!);
    } else if (currentState.phase === GamePhase.FLOP) {
        nextPhaseEnum = GamePhase.TURN;
        nextCommCards.push(deck.pop()!);
    } else if (currentState.phase === GamePhase.TURN) {
        nextPhaseEnum = GamePhase.RIVER;
        nextCommCards.push(deck.pop()!);
    } else if (currentState.phase === GamePhase.RIVER) {
        resolveWinner(updatedPlayers);
        return;
    }

    // Determine first player to act (Left of Dealer)
    let firstIdx = (currentState.dealerIndex + 1) % TOTAL_PLAYERS;
    while(updatedPlayers[firstIdx].status !== PlayerStatus.ACTIVE && updatedPlayers[firstIdx].status !== PlayerStatus.ALL_IN) {
        firstIdx = (firstIdx + 1) % TOTAL_PLAYERS;
        if(updatedPlayers.filter(p => p.status !== PlayerStatus.BUSTED).length === 0) break;
    }
    
    // Handle All-In Case for next phase start
    if (updatedPlayers[firstIdx].status === PlayerStatus.ALL_IN) {
        let tempIdx = firstIdx;
        let activeFound = false;
        for(let i=0; i<TOTAL_PLAYERS; i++) {
             if(updatedPlayers[tempIdx].status === PlayerStatus.ACTIVE) {
                 firstIdx = tempIdx;
                 activeFound = true;
                 break;
             }
             tempIdx = (tempIdx + 1) % TOTAL_PLAYERS;
        }
        if (!activeFound) {
             setGameState(prev => ({
                ...prev,
                players: updatedPlayers,
                currentHighBet: 0,
                phase: nextPhaseEnum,
                communityCards: nextCommCards,
                deck,
                message: `Dealing ${nextPhaseEnum}...`
             }));
             setTimeout(nextPhase, 1500); 
             return;
        }
    }

    setGameState(prev => ({
        ...prev,
        players: updatedPlayers,
        currentHighBet: 0,
        activePlayerIndex: firstIdx,
        phase: nextPhaseEnum,
        communityCards: nextCommCards,
        deck,
        message: `Dealing ${nextPhaseEnum}...`
    }));
  };

  const resolveWinner = (currentPlayers: Player[]) => {
    const activeAndAllIn = currentPlayers.filter(p => p.status !== PlayerStatus.FOLDED && p.status !== PlayerStatus.BUSTED);
    const commCards = gameStateRef.current.communityCards;
    
    let results: ShowdownResult[] = [];

    if (activeAndAllIn.length === 1) {
        // Everyone else folded
        const w = activeAndAllIn[0];
        results.push({
            playerId: w.id,
            name: w.name,
            role: w.role,
            handDescription: 'Last Player Standing',
            holeCards: w.hand,
            winningCards: [],
            amount: gameStateRef.current.pot,
            isWinner: true,
            score: 9999
        });
    } else {
        // Showdown calculation for ALL active players
        const evaluated = activeAndAllIn.map(p => ({
            player: p,
            rank: evaluateHand(p.hand, commCards)
        }));
        
        // Sort by score descending
        evaluated.sort((a, b) => b.rank.score - a.rank.score);
        
        const bestScore = evaluated[0].rank.score;
        const ties = evaluated.filter(r => r.rank.score === bestScore);
        const splitAmt = Math.floor(gameStateRef.current.pot / ties.length);

        results = evaluated.map(e => {
            const isWinner = e.rank.score === bestScore;
            return {
                playerId: e.player.id,
                name: e.player.name,
                role: e.player.role,
                handDescription: e.rank.name,
                holeCards: e.player.hand,
                winningCards: e.rank.cards,
                amount: isWinner ? splitAmt : 0,
                isWinner: isWinner,
                score: e.rank.score
            };
        });
    }

    // Distribute Chips
    const nextPlayers = currentPlayers.map(p => {
        const res = results.find(r => r.playerId === p.id);
        if (res && res.isWinner) {
            return { ...p, chips: p.chips + res.amount, status: p.chips + res.amount > 0 ? PlayerStatus.ACTIVE : PlayerStatus.BUSTED };
        }
        return p;
    });

    // Find winners for text display
    const actualWinners = results.filter(r => r.isWinner);
    const winMsg = actualWinners.length > 1 ? "Split Pot!" : `${actualWinners[0].name} Wins!`;

    setGameState(prev => ({
        ...prev,
        players: nextPlayers,
        phase: GamePhase.SHOWDOWN,
        activePlayerIndex: -1,
        showdownResults: results,
        message: winMsg
    }));
  };

  const handleNextHand = () => {
    const currentState = gameStateRef.current;
    
    // Logic: The game only ends if explicitly triggered by startNewHand when only 1 player is left.
    // We just try to start a new hand.
    
    const nextDealer = (currentState.dealerIndex + 1) % TOTAL_PLAYERS;
    startNewHand(currentState.players, nextDealer);
  };

  // -------------------------------------------------------------------------
  // UI Render
  // -------------------------------------------------------------------------
  
  if (setupMode) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
        <h1 className="text-4xl md:text-6xl font-bold mb-8 text-yellow-500">Gemini Poker</h1>
        <div className="bg-gray-800 p-8 rounded-lg shadow-2xl w-full max-w-md">
           <label className="block mb-4">
             <span className="text-gray-300">Initial Buy-In ($)</span>
             <input 
               type="number" 
               value={buyIn} 
               onChange={(e) => setBuyIn(parseInt(e.target.value))}
               className="mt-1 block w-full rounded-md bg-gray-700 border-transparent focus:border-yellow-500 focus:ring-0 text-white p-2"
             />
           </label>
           <button 
             onClick={startGame}
             className="w-full bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-3 px-4 rounded transition duration-200"
           >
             Sit at the Table
           </button>
           <p className="mt-4 text-sm text-gray-500 text-center">
             You will face 8 AI opponents powered by Google Gemini.
             <br/>
             Good Luck!
           </p>
        </div>
      </div>
    );
  }

  const getPosition = (index: number) => {
     const userPlayer = gameState.players.find(p => p.role === PlayerRole.USER);
     const userIndex = userPlayer ? userPlayer.id : 0;
     const relativeIdx = (index - userIndex + TOTAL_PLAYERS) % TOTAL_PLAYERS;
     const angleStep = 360 / TOTAL_PLAYERS;
     const angleDeg = 90 + (relativeIdx * angleStep);
     const angleRad = (angleDeg * Math.PI) / 180;
     const rx = 42; 
     const ry = 35; 
     const x = 50 + rx * Math.cos(angleRad);
     const y = 50 + ry * Math.sin(angleRad);
     return { left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' };
  };

  const userPlayer = gameState.players.find(p => p.role === PlayerRole.USER);
  const canUserAct = gameState.activePlayerIndex === userPlayer?.id && gameState.isGameRunning && gameState.phase !== GamePhase.SHOWDOWN && gameState.phase !== GamePhase.GAME_OVER;
  
  // Helper to check if a card is in the winning hand for the winner
  const isWinningCard = (card: Card, winnerResult?: ShowdownResult) => {
      if (!winnerResult) return false;
      return winnerResult.winningCards.some(wc => wc.rank === card.rank && wc.suit === card.suit);
  };
  // Helper for current player result highlighting
  const isUsedCard = (card: Card, result: ShowdownResult) => {
      return result.winningCards.some(wc => wc.rank === card.rank && wc.suit === card.suit);
  };

  const winnerResult = gameState.showdownResults.length > 0 ? gameState.showdownResults.filter(r => r.isWinner)[0] : undefined;
  const endTitleText = winnerResult ? (gameState.showdownResults.filter(r => r.isWinner).length > 1 ? "Split Pot" : `${winnerResult.name} Wins!`) : "";

  return (
    <div className="relative w-full h-screen bg-gray-900 overflow-hidden">
      {/* Restart/Exit Button */}
      <div className="absolute top-4 right-4 z-50">
          <button 
            onClick={quitGame}
            className="px-4 py-2 bg-gray-700 hover:bg-red-600 text-white text-sm font-bold rounded shadow-lg transition-colors border border-gray-500"
          >
            Restart / Exit
          </button>
      </div>

      {/* Table Background */}
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[95%] h-[60%] md:w-[80%] md:h-[70%] felt-texture rounded-[200px] border-[16px] border-[#3e2723] shadow-2xl flex items-center justify-center">
         {/* Community Cards */}
         <div className="flex gap-2">
            {gameState.communityCards.map((c, i) => (
                <CardComponent key={i} card={c} />
            ))}
            {Array.from({length: 5 - gameState.communityCards.length}).map((_, i) => (
                 <div key={i} className="w-10 h-14 md:w-14 md:h-20 border-2 border-white/20 rounded bg-black/10"></div>
            ))}
         </div>
         
         {/* Pot Info */}
         <div className="absolute top-1/3 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center">
             <div className="text-yellow-400 font-bold text-lg md:text-2xl drop-shadow-md">Pot: ${gameState.pot}</div>
             <div className="text-white/60 text-xs md:text-sm">{gameState.message}</div>
         </div>
      </div>

      {/* Players */}
      {gameState.players.map((p) => (
        <PlayerSeat 
            key={p.id} 
            player={p} 
            isActive={gameState.activePlayerIndex === p.id}
            isDealer={gameState.dealerIndex === p.id}
            phase={gameState.phase}
            positionStyle={getPosition(p.id)}
        />
      ))}

      {/* Showdown Results Overlay */}
      {gameState.phase === GamePhase.SHOWDOWN && gameState.showdownResults.length > 0 && (
         <div className="absolute inset-0 bg-black/95 z-50 flex flex-col items-center justify-start animate-fade-in p-4 overflow-y-auto">
             
             {/* Header */}
             <div className="mt-8 mb-6 text-center">
                 <h2 className="text-4xl md:text-5xl text-yellow-500 font-bold animate-bounce drop-shadow-lg mb-4">
                    {endTitleText}
                 </h2>
                 {/* Community Cards Display in Overlay */}
                 <div className="flex flex-col items-center p-4 bg-green-900/30 rounded-xl border border-green-800">
                    <span className="text-gray-400 text-xs uppercase tracking-widest mb-2">Community Cards</span>
                    <div className="flex gap-2">
                        {gameState.communityCards.map((c, i) => (
                            <CardComponent 
                                key={i} 
                                card={c} 
                                className={`transform transition-all ${isWinningCard(c, winnerResult) ? 'scale-110 ring-4 ring-yellow-400 z-10' : 'opacity-75 scale-95'}`} 
                            />
                        ))}
                    </div>
                 </div>
             </div>

             {/* Results Grid */}
             <div className="flex flex-col gap-3 w-full max-w-5xl px-2 pb-24">
                 {gameState.showdownResults.map((result, idx) => (
                    <div 
                        key={idx} 
                        className={`flex flex-col md:flex-row items-center justify-between p-4 rounded-xl border-2 transition-all
                        ${result.isWinner ? 'bg-gradient-to-r from-green-900/50 to-green-800/50 border-yellow-500 shadow-[0_0_30px_rgba(234,179,8,0.2)] scale-[1.02]' : 'bg-gray-800/60 border-gray-700'}`}
                    >
                        {/* Player Info */}
                        <div className="flex items-center gap-4 w-full md:w-1/4 mb-4 md:mb-0">
                            <div className={`text-xl font-bold truncate ${result.isWinner ? 'text-yellow-300' : 'text-gray-300'}`}>
                                {result.name}
                            </div>
                            {result.amount > 0 && (
                                <div className="bg-green-500/20 text-green-400 px-3 py-1 rounded-full font-mono font-bold border border-green-500/50">
                                    +${result.amount}
                                </div>
                            )}
                        </div>

                        {/* Hole Cards - Highlight used cards */}
                        <div className="flex flex-col items-center w-full md:w-1/4 mb-4 md:mb-0">
                            <span className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Hole Cards</span>
                            <div className="flex gap-2">
                                {result.holeCards.map((c, i) => (
                                    <CardComponent 
                                        key={i} 
                                        card={c} 
                                        className={`transform transition-all ${isUsedCard(c, result) ? 'ring-2 ring-yellow-400 -translate-y-2' : 'brightness-75'}`}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Hand Name */}
                        <div className="w-full md:w-1/5 text-center mb-4 md:mb-0">
                             <div className={`font-bold text-lg ${result.isWinner ? 'text-white' : 'text-gray-400'}`}>
                                {result.handDescription}
                             </div>
                        </div>

                        {/* Best 5 Combo Display */}
                        <div className="flex flex-col items-center w-full md:w-1/3 bg-black/20 p-2 rounded-lg">
                            <span className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Winning Hand</span>
                            <div className="flex gap-1">
                                {result.winningCards.length > 0 ? (
                                    result.winningCards.map((c, i) => (
                                        <CardComponent key={i} card={c} className={`scale-75 origin-center ${result.isWinner ? 'ring-1 ring-yellow-400/50' : ''}`} />
                                    ))
                                ) : (
                                    <span className="text-sm text-gray-500 italic">Folded</span>
                                )}
                            </div>
                        </div>
                    </div>
                 ))}
             </div>
             
             {/* Bottom Floating Button */}
             <div className="fixed bottom-8 z-50">
                <button 
                    onClick={handleNextHand}
                    className="px-12 py-4 bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-black font-black uppercase tracking-widest rounded-full text-xl shadow-[0_0_30px_rgba(234,179,8,0.6)] active:scale-95 transition-all transform hover:-translate-y-1 border-4 border-yellow-300"
                >
                    Next Hand
                </button>
             </div>
         </div>
      )}

      {/* Game Over Screen */}
      {gameState.phase === GamePhase.GAME_OVER && (
          <div className="absolute inset-0 bg-black/95 z-50 flex flex-col items-center justify-center animate-fade-in p-4">
              {userPlayer?.status === PlayerStatus.BUSTED ? (
                  <>
                    <h2 className="text-6xl md:text-8xl font-black text-red-600 mb-6 drop-shadow-[0_0_20px_rgba(220,38,38,0.6)]">DEFEAT</h2>
                    <p className="text-2xl text-gray-400 mb-12">You have been eliminated.</p>
                  </>
              ) : (
                  <>
                    <h2 className="text-6xl md:text-8xl font-black text-yellow-500 mb-6 drop-shadow-[0_0_30px_rgba(234,179,8,0.8)] animate-pulse">CHAMPION!</h2>
                    <p className="text-2xl text-white mb-12">You are the last player standing!</p>
                  </>
              )}
              
              <button 
                onClick={quitGame}
                className="px-12 py-5 bg-white text-black font-black uppercase tracking-widest rounded-full text-xl shadow-2xl hover:bg-gray-200 transition-colors"
              >
                Return to Menu
              </button>
          </div>
      )}

      {/* User Controls */}
      {userPlayer && (
          <Controls 
            canAct={canUserAct}
            onAction={(action, amt) => executePlayerAction(userPlayer.id, action, amt)}
            callAmount={gameState.currentHighBet - userPlayer.currentBet}
            minRaise={gameState.currentHighBet > 0 ? gameState.currentHighBet * 2 : gameState.minBet}
            userChips={userPlayer.chips}
            step={10}
            isBettingRoundOpen={gameState.currentHighBet === 0}
          />
      )}
    </div>
  );
};

export default App;