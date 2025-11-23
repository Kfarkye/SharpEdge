
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { fetchSchedule } from '../services/nhlAi';
import { GameData, League } from '../types';
import { GameCard } from './GameCard';
import { RefreshCw, AlertCircle, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

interface ScheduleViewProps {
  onAnalyze?: (game: GameData) => void;
  league: League;
}

export const ScheduleView: React.FC<ScheduleViewProps> = ({ onAnalyze, league }) => {
  const [games, setGames] = useState<GameData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedBook, setSelectedBook] = useState<string>('draftkings');
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  
  // Date State
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  
  const refreshIntervalRef = useRef<number | null>(null);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(false);
    try {
      // Pass the selected currentDate to the fetcher
      const data = await fetchSchedule(league, currentDate);
      if (data) { 
        setGames(data);
        setLastUpdated(new Date());
      }
    } catch (e) {
      console.error(e);
      setError(true);
    } finally {
      setIsLoading(false);
    }
  }, [league, currentDate]);

  // Initial load and auto-refresh
  useEffect(() => {
    loadData();

    // Auto-refresh every 30s only if looking at Today or Future
    const today = new Date();
    const isToday = currentDate.getDate() === today.getDate() && 
                    currentDate.getMonth() === today.getMonth();
    
    if (isToday) {
        refreshIntervalRef.current = window.setInterval(() => {
            loadData(true); 
        }, 30000);
    }

    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [loadData, currentDate]);

  // Handle Date Navigation
  const changeDate = (days: number) => {
      const newDate = new Date(currentDate);
      newDate.setDate(newDate.getDate() + days);
      setCurrentDate(newDate);
  };
  
  const formatDate = (date: Date) => {
      const today = new Date();
      // Check if Today
      if (date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear()) {
          return "Today";
      }
      
      // Check if Tomorrow
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (date.getDate() === tomorrow.getDate() && date.getMonth() === tomorrow.getMonth() && date.getFullYear() === tomorrow.getFullYear()) {
          return "Tomorrow";
      }
      
      // Check if Yesterday
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      if (date.getDate() === yesterday.getDate() && date.getMonth() === yesterday.getMonth() && date.getFullYear() === yesterday.getFullYear()) {
          return "Yesterday";
      }

      return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const books = [
    { id: 'draftkings', label: 'DK' },
    { id: 'fanduel', label: 'FD' },
    { id: 'betmgm', label: 'MGM' },
    { id: 'williamhill', label: 'CZR' },
  ];

  if (isLoading && games.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
        <p className="text-[10px] text-textTertiary uppercase tracking-widest animate-pulse font-medium">Syncing {league} Odds...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 animate-slide-up">
        <div className="w-12 h-12 rounded-full bg-danger/10 flex items-center justify-center mb-4 border border-danger/10">
          <AlertCircle className="w-6 h-6 text-danger" />
        </div>
        <h3 className="text-lg font-bold text-textPrimary mb-2">Market Unavailable</h3>
        <p className="text-sm text-textSecondary mb-6 max-w-xs mx-auto leading-relaxed">
          Could not retrieve the slate for this date. The market might be closed.
        </p>
        <button 
          onClick={() => loadData(false)}
          className="glass-button px-6 py-2 rounded-full text-sm font-medium text-textPrimary flex items-center gap-2"
        >
          <RefreshCw size={14} /> Retry Sync
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 md:px-6 py-2 pb-20 animate-slide-up">
      {/* Date Navigation & Controls Header */}
      <div className="flex flex-col gap-4 mb-4">
          
          {/* Top Row: League/Status & Last Update */}
          <div className="flex items-center justify-between px-1">
             <div className="flex items-center gap-3">
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                </span>
                <div className="flex flex-col">
                  <h2 className="text-xs font-bold text-textSecondary tracking-widest uppercase">{league} Board</h2>
                  <span className="text-[9px] text-textTertiary font-mono hidden md:block">
                    Updated: {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
            </div>
            
            {/* Date Navigator */}
            <div className="flex items-center bg-surfaceHighlight/50 border border-border/10 rounded-full p-0.5">
                <button 
                    onClick={() => changeDate(-1)}
                    className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-surface text-textTertiary hover:text-textPrimary transition-colors"
                    aria-label="Previous Day"
                >
                    <ChevronLeft size={16} />
                </button>
                <div className="px-4 min-w-[100px] text-center">
                    <span className="text-xs font-bold text-textPrimary uppercase tracking-wide">
                        {formatDate(currentDate)}
                    </span>
                </div>
                <button 
                    onClick={() => changeDate(1)}
                    className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-surface text-textTertiary hover:text-textPrimary transition-colors"
                    aria-label="Next Day"
                >
                    <ChevronRight size={16} />
                </button>
            </div>
          </div>
          
          {/* Bottom Row: Bookmaker Toggle */}
          <div className="flex justify-end px-1">
            <div className="flex bg-surfaceHighlight/50 border border-border/10 rounded-lg p-0.5">
              {books.map((book) => (
                 <button
                   key={book.id}
                   onClick={() => setSelectedBook(book.id)}
                   className={`
                     px-2 md:px-3 py-1 text-[10px] font-bold rounded-md transition-all duration-300
                     ${selectedBook === book.id 
                       ? 'bg-surface shadow-sm text-accent' 
                       : 'text-textTertiary hover:text-textSecondary'}
                   `}
                 >
                   {book.label}
                 </button>
              ))}
            </div>
          </div>
      </div>
      
      <div className="space-y-0">
        {games.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 opacity-50">
             <Calendar className="w-8 h-8 mb-3 text-textTertiary" />
             <p className="text-sm font-medium">No {league} games scheduled for {formatDate(currentDate)}.</p>
          </div>
        ) : (
          games.map((game, idx) => (
            <GameCard key={game.id || idx} game={game} selectedBook={selectedBook} onAnalyze={onAnalyze} />
          ))
        )}
      </div>
      
      <div className="flex flex-col items-center mt-12 gap-2 opacity-50 hover:opacity-100 transition-opacity">
        <span className="text-[9px] font-bold text-textTertiary uppercase tracking-widest">
           SharpEdge Analytics Engine
        </span>
        <div className="h-px w-12 bg-border/20"></div>
      </div>
    </div>
  );
};
