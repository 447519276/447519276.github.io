import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GameState, Player, PlayerRole, PlayerStatus, GamePhase, Card, Suit, ShowdownResult } from './types.ts';
import { createDeck, shuffleDeck, evaluateHand } from './utils/pokerLogic.ts';
import { PlayerSeat } from './components/PlayerSeat.tsx';
import { CardComponent } from './components/CardComponent.tsx';
import { Controls } from './components/Controls.tsx';
import { getBotDecision } from './services/geminiService.ts';

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
        message: 'Welcome to Gemini Poker',
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
        setGameState((prev) => ({ ...prev, message: msg }));
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
                name: i === userIndex ? 'You' : `Bot ${i + 1}`,
                role: i === userIndex ? PlayerRole.USER : PlayerRole.BOT,
                chips: buyIn,
                hand: [],
                status: PlayerStatus.ACTIVE,
                currentBet: 0,
                totalHandBet: 0,
            });
        }

        setSetupMode(false);
        startNewHand(players, 0); // Start with dealer at 0
    };

    const quitGame = () => {
        setSetupMode(true);
        setGameState((prev) => ({ ...prev, isGameRunning: false }));
    };

    const startNewHand = (currentPlayers: Player[], dealerIdx: number) => {
        // 1. Reset statuses based on chips ONLY.
        // This is the core logic that decides if someone is BUSTED or ACTIVE.
        const players = currentPlayers.map((p) => ({
            ...p,
            status: p.chips > 0 ? PlayerStatus.ACTIVE : PlayerStatus.BUSTED,
            hand: [],
            currentBet: 0,
            lastAction: undefined,
            totalHandBet: 0,
        }));

        // 2. CHECK GAME OVER CONDITION
        // Game ends IF user is busted OR ALL bots are busted.
        const user = players.find((p) => p.role === PlayerRole.USER);
        const activeBots = players.filter((p) => p.role === PlayerRole.BOT && p.status === PlayerStatus.ACTIVE);

        if (!user || user.status === PlayerStatus.BUSTED) {
            setGameState((prev) => ({
                ...prev,
                players,
                isGameRunning: false,
                phase: GamePhase.GAME_OVER,
                message: 'You have been eliminated.',
            }));
            return;
        }

        if (activeBots.length === 0) {
            setGameState((prev) => ({
                ...prev,
                players,
                isGameRunning: false,
                phase: GamePhase.GAME_OVER,
                message: "You are the Champion! You've won all the chips!",
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

        // Blinds calculation
        let sbIndex = (dealerIdx + 1) % TOTAL_PLAYERS;
        while (players[sbIndex].status === PlayerStatus.BUSTED) sbIndex = (sbIndex + 1) % TOTAL_PLAYERS;

        let bbIndex = (sbIndex + 1) % TOTAL_PLAYERS;
        while (players[bbIndex].status === PlayerStatus.BUSTED) bbIndex = (bbIndex + 1) % TOTAL_PLAYERS;

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
        while (players[firstActionIndex].status === PlayerStatus.BUSTED) firstActionIndex = (firstActionIndex + 1) % TOTAL_PLAYERS;

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
            message: 'New Hand Started',
        });
    };

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
            console.warn('Bot AI error, falling back to fold/check.');
            executePlayerAction(playerIdx, 'FOLD');
        }
    };

    const executePlayerAction = (playerIndex: number, action: string, amount?: number) => {
        setGameState((prev) => {
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
                const minRaiseAbs = prev.currentHighBet > 0 ? prev.currentHighBet * 2 : prev.minBet;
                let raiseTo = amount || minRaiseAbs;
                const maxTotal = p.chips + p.currentBet;
                if (raiseTo > maxTotal) raiseTo = maxTotal;
                if (raiseTo < minRaiseAbs && raiseTo < maxTotal) raiseTo = minRaiseAbs;

                const addedChips = raiseTo - p.currentBet;
                if (addedChips > p.chips) {
                    const actualAdd = p.chips;
                    p.chips = 0;
                    p.currentBet += actualAdd;
                    p.totalHandBet += actualAdd;
                    newPot += actualAdd;
                    p.status = PlayerStatus.ALL_IN;
                    p.lastAction = 'All In';
                    if (p.currentBet > newHighBet) newHighBet = p.currentBet;
                } else {
                    p.chips -= addedChips;
                    p.currentBet = raiseTo;
                    p.totalHandBet += addedChips;
                    newPot += addedChips;
                    if (raiseTo > newHighBet) newHighBet = raiseTo;
                    if (p.chips === 0) p.status = PlayerStatus.ALL_IN;
                    p.lastAction = action === 'BET' ? `Bet ${raiseTo}` : `Raise to ${raiseTo}`;
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

            return { ...prev, players: newPlayers, pot: newPot, currentHighBet: newHighBet, message: msg };
        });

        setTimeout(() => advanceTurn(), 300);
    };

    const advanceTurn = () => {
        const currentState = gameStateRef.current;
        const nonFolded = currentState.players.filter((p) => p.status !== PlayerStatus.FOLDED && p.status !== PlayerStatus.BUSTED);

        if (nonFolded.length === 1) {
            resolveWinner(currentState.players);
            return;
        }

        const activePlayers = currentState.players.filter((p) => p.status === PlayerStatus.ACTIVE);
        const allInPlayers = currentState.players.filter((p) => p.status === PlayerStatus.ALL_IN);

        // If everyone who can act has matched the high bet, go to next phase
        const allMatched = activePlayers.every((p) => p.currentBet === currentState.currentHighBet && p.lastAction !== undefined);

        if (activePlayers.length === 0 || (activePlayers.length === 1 && allMatched) || allMatched) {
            nextPhase();
            return;
        }

        // Find next player
        let nextIdx = (currentState.activePlayerIndex + 1) % TOTAL_PLAYERS;
        let found = false;
        for (let i = 0; i < TOTAL_PLAYERS; i++) {
            if (currentState.players[nextIdx].status === PlayerStatus.ACTIVE) {
                found = true;
                break;
            }
            nextIdx = (nextIdx + 1) % TOTAL_PLAYERS;
        }

        if (found) {
            setGameState((prev) => ({ ...prev, activePlayerIndex: nextIdx }));
        } else {
            nextPhase();
        }
    };

    const nextPhase = () => {
        const currentState = gameStateRef.current;
        const updatedPlayers = currentState.players.map((p) => ({ ...p, currentBet: 0, lastAction: undefined }));
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

        // Determine first player to act
        let firstIdx = (currentState.dealerIndex + 1) % TOTAL_PLAYERS;
        while (
            updatedPlayers[firstIdx].status !== PlayerStatus.ACTIVE &&
            updatedPlayers[firstIdx].status !== PlayerStatus.ALL_IN &&
            updatedPlayers[firstIdx].status !== PlayerStatus.FOLDED
        ) {
            firstIdx = (firstIdx + 1) % TOTAL_PLAYERS;
        }

        // Auto-advance if no one can bet (everyone all-in or folded)
        const canStillBet = updatedPlayers.filter((p) => p.status === PlayerStatus.ACTIVE).length;
        if (canStillBet < 2) {
            setGameState((prev) => ({
                ...prev,
                players: updatedPlayers,
                currentHighBet: 0,
                phase: nextPhaseEnum,
                communityCards: nextCommCards,
                deck,
                message: `Dealing ${nextPhaseEnum}...`,
            }));
            setTimeout(() => nextPhase(), 800);
            return;
        }

        setGameState((prev) => ({
            ...prev,
            players: updatedPlayers,
            currentHighBet: 0,
            activePlayerIndex: firstIdx,
            phase: nextPhaseEnum,
            communityCards: nextCommCards,
            deck,
            message: `Dealing ${nextPhaseEnum}...`,
        }));
    };

    const resolveWinner = (currentPlayers: Player[]) => {
        const activeAndAllIn = currentPlayers.filter((p) => p.status !== PlayerStatus.FOLDED && p.status !== PlayerStatus.BUSTED);
        const commCards = gameStateRef.current.communityCards;
        let results: ShowdownResult[] = [];

        if (activeAndAllIn.length === 1) {
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
                score: 9999,
            });
        } else {
            const evaluated = activeAndAllIn.map((p) => ({ player: p, rank: evaluateHand(p.hand, commCards) }));
            evaluated.sort((a, b) => b.rank.score - a.rank.score);
            const bestScore = evaluated[0].rank.score;
            const ties = evaluated.filter((r) => r.rank.score === bestScore);
            const splitAmt = Math.floor(gameStateRef.current.pot / ties.length);

            results = evaluated.map((e) => {
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
                    score: e.rank.score,
                };
            });
        }

        const nextPlayers = currentPlayers.map((p) => {
            const res = results.find((r) => r.playerId === p.id);
            if (res && res.isWinner) {
                return { ...p, chips: p.chips + res.amount };
            }
            return p;
        });

        setGameState((prev) => ({
            ...prev,
            players: nextPlayers,
            phase: GamePhase.SHOWDOWN,
            activePlayerIndex: -1,
            showdownResults: results,
            message: results.filter((r) => r.isWinner).length > 1 ? 'Split Pot!' : `${results.find((r) => r.isWinner)?.name} Wins!`,
        }));
    };

    const handleNextHand = () => {
        const currentState = gameStateRef.current;
        const nextDealer = (currentState.dealerIndex + 1) % TOTAL_PLAYERS;
        startNewHand(currentState.players, nextDealer);
    };

    if (setupMode) {
        return (
            <div className='flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4'>
                <h1 className='text-4xl md:text-6xl font-bold mb-8 text-yellow-500'>Gemini Poker</h1>
                <div className='bg-gray-800 p-8 rounded-lg shadow-2xl w-full max-w-md'>
                    <label className='block mb-4'>
                        <span className='text-gray-300 font-bold'>Initial Buy-In ($)</span>
                        <input
                            type='number'
                            value={buyIn}
                            onChange={(e) => setBuyIn(parseInt(e.target.value))}
                            className='mt-1 block w-full rounded-md bg-gray-700 border-transparent focus:border-yellow-500 text-white p-3 font-mono'
                        />
                    </label>
                    <button
                        onClick={startGame}
                        className='w-full bg-yellow-600 hover:bg-yellow-700 text-white font-black py-4 rounded shadow-xl transition-all transform hover:scale-105'>
                        Sit at the Table
                    </button>
                    <p className='mt-6 text-xs text-gray-500 text-center leading-relaxed'>
                        Facing 8 AI opponents. The game only ends when you lose everything or you become the sole winner of all chips.
                    </p>
                </div>
            </div>
        );
    }

    const getPosition = (index: number) => {
        const userPlayer = gameState.players.find((p) => p.role === PlayerRole.USER);
        const userIndex = userPlayer ? userPlayer.id : 0;
        const relativeIdx = (index - userIndex + TOTAL_PLAYERS) % TOTAL_PLAYERS;
        const angleDeg = 90 + relativeIdx * (360 / TOTAL_PLAYERS);
        const angleRad = (angleDeg * Math.PI) / 180;
        return { left: `${50 + 42 * Math.cos(angleRad)}%`, top: `${50 + 35 * Math.sin(angleRad)}%`, transform: 'translate(-50%, -50%)' };
    };

    const userPlayer = gameState.players.find((p) => p.role === PlayerRole.USER);
    const canUserAct =
        gameState.activePlayerIndex === userPlayer?.id &&
        gameState.isGameRunning &&
        gameState.phase !== GamePhase.SHOWDOWN &&
        gameState.phase !== GamePhase.GAME_OVER;

    return (
        <div className='relative w-full h-screen bg-gray-950 overflow-hidden'>
            <div className='absolute top-4 right-4 z-50 flex gap-2'>
                <button
                    onClick={quitGame}
                    className='px-3 py-1 bg-gray-800 hover:bg-red-900 text-gray-300 text-xs rounded border border-gray-700 transition-colors'>
                    Restart / Exit
                </button>
            </div>

            <div className='absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[92%] h-[58%] md:w-[75%] md:h-[65%] felt-texture rounded-[200px] border-[14px] border-[#2e1a1a] shadow-[inset_0_0_100px_rgba(0,0,0,0.8)] flex items-center justify-center'>
                <div className='flex gap-2'>
                    {gameState.communityCards.map((c, i) => (
                        <CardComponent
                            key={i}
                            card={c}
                        />
                    ))}
                    {Array.from({ length: 5 - gameState.communityCards.length }).map((_, i) => (
                        <div
                            key={i}
                            className='w-10 h-14 md:w-14 md:h-20 border border-white/10 rounded bg-black/5'></div>
                    ))}
                </div>
                <div className='absolute top-1/3 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none'>
                    <div className='text-yellow-400 font-black text-2xl md:text-4xl drop-shadow-lg mb-1'>$ {gameState.pot}</div>
                    <div className='text-white/40 text-[10px] md:text-xs uppercase tracking-widest'>{gameState.message}</div>
                </div>
            </div>

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

            {gameState.phase === GamePhase.SHOWDOWN && (
                <div className='absolute inset-0 bg-black/95 z-50 flex flex-col items-center justify-start animate-fade-in p-4 overflow-y-auto'>
                    <div className='mt-12 text-center'>
                        <h2 className='text-4xl md:text-6xl text-yellow-500 font-black mb-8 drop-shadow-lg uppercase tracking-tighter italic'>
                            Hand Over
                        </h2>
                        <button
                            onClick={handleNextHand}
                            className='px-16 py-4 bg-yellow-500 hover:bg-yellow-400 text-black font-black uppercase rounded-full text-xl shadow-2xl transition-transform active:scale-95 border-b-4 border-yellow-700'>
                            Next Hand
                        </button>
                    </div>
                    <div className='flex flex-col gap-3 w-full max-w-4xl mt-12 mb-24 px-4'>
                        {gameState.showdownResults.map((result, idx) => (
                            <div
                                key={idx}
                                className={`flex items-center justify-between p-4 rounded-xl border-2 ${
                                    result.isWinner ? 'bg-green-900/40 border-yellow-500' : 'bg-gray-800/40 border-gray-700'
                                }`}>
                                <div className='w-1/3 font-bold text-lg'>
                                    {result.name} {result.isWinner && '🏆'}
                                </div>
                                <div className='w-1/3 text-center italic text-gray-400'>{result.handDescription}</div>
                                <div className='w-1/3 text-right text-yellow-500 font-mono font-bold'>
                                    {result.amount > 0 ? `+$${result.amount}` : '-'}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {gameState.phase === GamePhase.GAME_OVER && (
                <div className='absolute inset-0 bg-black/98 z-50 flex flex-col items-center justify-center animate-fade-in p-4 text-center'>
                    <h2
                        className={`text-6xl md:text-9xl font-black mb-4 uppercase ${
                            userPlayer?.status === PlayerStatus.BUSTED ? 'text-red-600' : 'text-yellow-500 animate-pulse'
                        }`}>
                        {userPlayer?.status === PlayerStatus.BUSTED ? 'Game Over' : 'Champion!'}
                    </h2>
                    <p className='text-xl md:text-3xl text-gray-400 mb-12 max-w-2xl'>{gameState.message}</p>
                    <button
                        onClick={quitGame}
                        className='px-16 py-5 bg-white text-black font-black uppercase tracking-widest rounded-full text-xl hover:bg-gray-200 transition-colors shadow-2xl'>
                        Play Again
                    </button>
                </div>
            )}

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
