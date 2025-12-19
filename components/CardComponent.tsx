import React from 'react';
import { Card, Suit } from '../types';

interface Props {
  card: Card;
  hidden?: boolean;
  className?: string;
}

export const CardComponent: React.FC<Props> = ({ card, hidden = false, className = '' }) => {
  if (hidden) {
    return (
      <div className={`w-10 h-14 md:w-14 md:h-20 bg-blue-900 border-2 border-white rounded shadow-md flex items-center justify-center ${className}`}>
        <div className="w-full h-full bg-opacity-20 bg-white pattern-dots rounded-sm"></div>
      </div>
    );
  }

  const isRed = card.suit === Suit.HEARTS || card.suit === Suit.DIAMONDS;

  return (
    <div className={`w-10 h-14 md:w-14 md:h-20 bg-white rounded shadow-md flex flex-col items-center justify-between p-1 select-none border border-gray-300 ${className}`}>
      <div className={`self-start text-xs md:text-sm font-bold ${isRed ? 'text-red-600' : 'text-black'}`}>
        {card.display}
      </div>
      <div className={`text-lg md:text-2xl ${isRed ? 'text-red-600' : 'text-black'}`}>
        {card.suit}
      </div>
      <div className={`self-end text-xs md:text-sm font-bold ${isRed ? 'text-red-600' : 'text-black'} transform rotate-180`}>
        {card.display}
      </div>
    </div>
  );
};