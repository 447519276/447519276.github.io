import React from 'react';

interface Props {
  canAct: boolean;
  onAction: (action: string, amount?: number) => void;
  callAmount: number;
  minRaise: number;
  userChips: number;
  step: number;
  isBettingRoundOpen: boolean; // True if currentHighBet == 0 (no bets yet in this phase)
}

export const Controls: React.FC<Props> = ({ canAct, onAction, callAmount, minRaise, userChips, step, isBettingRoundOpen }) => {
  const [raiseAmount, setRaiseAmount] = React.useState(minRaise);

  // Sync raise amount if minRaise changes
  React.useEffect(() => {
    setRaiseAmount(prev => Math.max(minRaise, prev));
  }, [minRaise]);

  if (!canAct) return null;
  
  const betActionLabel = isBettingRoundOpen ? 'Bet' : 'Raise';
  const isAllIn = raiseAmount >= userChips;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900/90 border-t border-gray-700 p-4 pb-6 flex flex-col items-center justify-center gap-3 z-50 backdrop-blur-sm animate-slide-up">
      
      {/* Bet Slider Control - Compact */}
      <div className="w-full max-w-2xl flex items-center gap-4 bg-gray-800/50 p-3 rounded-lg border border-gray-600">
        <div className="flex-1 flex flex-col justify-center">
            <input 
              type="range" 
              min={minRaise} 
              max={userChips} 
              step={step}
              value={raiseAmount} 
              onChange={(e) => setRaiseAmount(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-yellow-500"
            />
             <div className="flex justify-between text-[10px] text-gray-400 mt-1 font-mono">
                <span>Min: {minRaise}</span>
                <span>Max: {userChips}</span>
            </div>
        </div>
        
        <div className="flex items-center gap-2">
            <div className="bg-black/40 border border-gray-600 text-yellow-400 font-mono text-lg font-bold px-3 py-1 rounded w-24 text-center">
                ${raiseAmount}
            </div>
            <button
              onClick={() => onAction(isBettingRoundOpen ? 'BET' : 'RAISE', raiseAmount)}
              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white font-bold rounded text-sm uppercase tracking-wide transition-colors border-b-2 border-yellow-800 active:border-b-0 active:translate-y-[2px]"
            >
              {isAllIn ? 'All In' : betActionLabel}
            </button>
        </div>
      </div>

      {/* Main Action Buttons - Classic Row */}
      <div className="flex gap-4 w-full max-w-2xl">
        <button
          onClick={() => onAction('FOLD')}
          className="flex-1 py-3 bg-red-700 hover:bg-red-600 text-white font-bold rounded shadow-md border-b-4 border-red-900 active:border-b-0 active:translate-y-1 transition-all uppercase tracking-wider"
        >
          Fold
        </button>
        
        <button
          onClick={() => onAction(callAmount === 0 ? 'CHECK' : 'CALL')}
          className="flex-1 py-3 bg-blue-700 hover:bg-blue-600 text-white font-bold rounded shadow-md border-b-4 border-blue-900 active:border-b-0 active:translate-y-1 transition-all uppercase tracking-wider"
        >
          {callAmount === 0 ? 'Check' : `Call ${callAmount}`}
        </button>

        <button
          onClick={() => onAction('ALL_IN', userChips)}
          className="flex-1 py-3 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded shadow-md border-b-4 border-orange-800 active:border-b-0 active:translate-y-1 transition-all uppercase tracking-wider"
        >
          All In (${userChips})
        </button>
      </div>
    </div>
  );
};