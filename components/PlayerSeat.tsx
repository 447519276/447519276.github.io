/*
 * @Author: QinHao
 * @Date: 2025-12-19 17:46:59
 * @LastEditors: qinhao
 * @LastEditTime: 2025-12-23 11:16:37
 * @FilePath: \religious-imsd:\work\447519276.github.io\components\PlayerSeat.tsx
 */
import React from 'react';
import { Player, PlayerRole, PlayerStatus, GamePhase } from '../types.ts';
import { CardComponent } from './CardComponent.tsx';

interface Props {
    player: Player;
    isActive: boolean;
    isDealer: boolean;
    phase: GamePhase;
    positionStyle: React.CSSProperties;
}

export const PlayerSeat: React.FC<Props> = ({ player, isActive, isDealer, phase, positionStyle }) => {
    const isUser = player.role === PlayerRole.USER;
    const isShowdown = phase === GamePhase.SHOWDOWN;

    // Logic to hide cards: Hide if it's a bot AND not showdown AND not folded (folded usually mucks)
    // If folded, we might hide or dim. Let's just dim and show back.
    const hideCards = !isUser && !isShowdown;

    return (
        <div
            className={`absolute flex flex-col items-center transition-all duration-300 ${
                player.status === PlayerStatus.FOLDED ? 'opacity-50 grayscale' : ''
            }`}
            style={positionStyle}>
            {/* Action Bubble */}
            {player.lastAction && (
                <div className='absolute -top-8 bg-yellow-400 text-black px-2 py-0.5 rounded-full text-xs font-bold animate-bounce z-20 shadow-lg border border-yellow-600'>
                    {player.lastAction}
                </div>
            )}

            {/* Cards */}
            <div className='flex -space-x-4 mb-2 relative z-10'>
                {player.hand.map((card, idx) => (
                    <div
                        key={idx}
                        className={`transform transition-transform ${isActive ? '-translate-y-2' : ''}`}>
                        <CardComponent
                            card={card}
                            hidden={hideCards}
                        />
                    </div>
                ))}
            </div>

            {/* Player Avatar Circle */}
            <div
                className={`relative w-16 h-16 md:w-20 md:h-20 rounded-full border-4 flex flex-col items-center justify-center shadow-lg bg-gray-800
        ${isActive ? 'border-yellow-400 ring-4 ring-yellow-400/30' : 'border-gray-600'}
        ${player.status === PlayerStatus.BUSTED ? 'bg-red-900' : ''}
      `}>
                <span className='text-xs text-gray-400 font-bold max-w-[90%] truncate text-center'>{player.name}</span>
                <span className='text-xs md:text-sm text-white font-mono font-bold'>${player.chips}</span>

                {/* Highlighted Dealer Button */}
                {isDealer && (
                    <div className='absolute -right-3 -bottom-2 w-8 h-8 bg-white text-black rounded-full border-2 border-gray-300 flex items-center justify-center font-black text-sm shadow-[0_0_10px_rgba(255,255,255,0.8)] z-30'>
                        D
                    </div>
                )}
            </div>

            {/* Current Round Bet */}
            {player.currentBet > 0 && (
                <div className='mt-1 bg-black/60 px-2 py-0.5 rounded-full text-white text-xs font-mono border border-gray-500'>
                    Bet: ${player.currentBet}
                </div>
            )}
        </div>
    );
};
