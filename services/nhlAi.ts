
import { GoogleGenAI, Chat } from "@google/genai";
import { Message, GameData, MarketData, League } from '../types';

const ODDS_API_KEY = '0e8fada7d6991609b61646b39e36c699';
const CACHE_DURATION = 2 * 60 * 1000; // Reduced cache to 2 mins for better live score updates
const API_BASE = 'https://api.the-odds-api.com/v4/sports';

// Cache to prevent hitting API limits too hard, but allow updates
// We now cache by league key AND date string to allow date switching
const oddsCache: Record<string, { data: GameData[], timestamp: number }> = {};
let rawScheduleContext: string = "";
let currentLeagueContext: League = 'NHL';

// --- TEAM MAPPINGS ---

const NHL_TEAM_ABBR_MAP: Record<string, string> = {
  "Anaheim Ducks": "ANA", "Boston Bruins": "BOS", "Buffalo Sabres": "BUF",
  "Calgary Flames": "CGY", "Carolina Hurricanes": "CAR", "Chicago Blackhawks": "CHI",
  "Colorado Avalanche": "COL", "Columbus Blue Jackets": "CBJ", "Dallas Stars": "DAL",
  "Detroit Red Wings": "DET", "Edmonton Oilers": "EDM", "Florida Panthers": "FLA",
  "Los Angeles Kings": "LAK", "Minnesota Wild": "MIN", "Montreal Canadiens": "MTL",
  "Nashville Predators": "NSH", "New Jersey Devils": "NJD", "New York Islanders": "NYI",
  "New York Rangers": "NYR", "Ottawa Senators": "OTT", "Philadelphia Flyers": "PHI",
  "Pittsburgh Penguins": "PIT", "San Jose Sharks": "SJS", "Seattle Kraken": "SEA",
  "St. Louis Blues": "STL", "Tampa Bay Lightning": "TBL", "Toronto Maple Leafs": "TOR",
  "Utah Hockey Club": "UTA", "Vancouver Canucks": "VAN", "Vegas Golden Knights": "VGK",
  "Washington Capitals": "WSH", "Winnipeg Jets": "WPG"
};

const NFL_TEAM_ABBR_MAP: Record<string, string> = {
  "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL",
  "Buffalo Bills": "BUF", "Carolina Panthers": "CAR", "Chicago Bears": "CHI",
  "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE", "Dallas Cowboys": "DAL",
  "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
  "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX",
  "Kansas City Chiefs": "KC", "Las Vegas Raiders": "LV", "Los Angeles Chargers": "LAC",
  "Los Angeles Rams": "LAR", "Miami Dolphins": "MIA", "Minnesota Vikings": "MIN",
  "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
  "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT",
  "San Francisco 49ers": "SF", "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB",
  "Tennessee Titans": "TEN", "Washington Commanders": "WSH"
};

const getAbbr = (name: string, league: League) => {
  const map = league === 'NHL' ? NHL_TEAM_ABBR_MAP : NFL_TEAM_ABBR_MAP;
  return map[name] || name.substring(0, 3).toUpperCase();
};

const fmtOdds = (price: number) => price > 0 ? `+${price}` : `${price}`;

// Helper to extract market data from a specific bookmaker object
const extractMarketData = (bookmaker: any, game: any): MarketData => {
  if (!bookmaker) {
    return {
      awayML: '-', homeML: '-',
      awayPL: '-', homePL: '-',
      total: '-', overOdds: '', underOdds: ''
    };
  }

  const h2h = bookmaker.markets.find((m: any) => m.key === 'h2h');
  const spreads = bookmaker.markets.find((m: any) => m.key === 'spreads');
  const totals = bookmaker.markets.find((m: any) => m.key === 'totals');

  // Handle various formats (api sometimes returns different outcome names)
  const awayH2H = h2h?.outcomes.find((o: any) => o.name === game.away_team);
  const homeH2H = h2h?.outcomes.find((o: any) => o.name === game.home_team);

  const awaySpread = spreads?.outcomes.find((o: any) => o.name === game.away_team);
  const homeSpread = spreads?.outcomes.find((o: any) => o.name === game.home_team);

  const over = totals?.outcomes.find((o: any) => o.name === 'Over');
  const under = totals?.outcomes.find((o: any) => o.name === 'Under');

  return {
    awayML: awayH2H ? fmtOdds(awayH2H.price) : '-',
    homeML: homeH2H ? fmtOdds(homeH2H.price) : '-',
    awayPL: awaySpread ? `${awaySpread.point > 0 ? '+' : ''}${awaySpread.point} (${fmtOdds(awaySpread.price)})` : '-',
    homePL: homeSpread ? `${homeSpread.point > 0 ? '+' : ''}${homeSpread.point} (${fmtOdds(homeSpread.price)})` : '-',
    total: over ? `${over.point}` : '-',
    overOdds: over ? fmtOdds(over.price) : '',
    underOdds: under ? fmtOdds(under.price) : ''
  };
};

// Fetch Standings (Currently optimized for NHL, returns empty for NFL until endpoint added)
const fetchStandings = async (league: League): Promise<Record<string, string>> => {
  if (league !== 'NHL') return {}; // TODO: Add NFL Standings source

  try {
    const res = await fetch('https://api-web.nhle.com/v1/standings/now');
    if (!res.ok) return {};
    const data = await res.json();
    
    const standings: Record<string, string> = {};
    if (data.standings) {
      data.standings.forEach((team: any) => {
         const abbr = team.teamAbbrev.default;
         const record = `${team.wins}-${team.losses}-${team.otLosses}`;
         standings[abbr] = record;
      });
    }
    return standings;
  } catch (e) {
    console.warn("Failed to fetch standings:", e);
    return {};
  }
};

// --- API FETCHING LOGIC ---

export const fetchSchedule = async (league: League = 'NHL', targetDate: Date = new Date()): Promise<GameData[]> => {
  const sportKey = league === 'NHL' ? 'icehockey_nhl' : 'americanfootball_nfl';
  currentLeagueContext = league; // Update context for AI
  
  // Format date for cache key (YYYY-MM-DD)
  const dateKey = targetDate.toISOString().split('T')[0];
  const cacheKey = `${league}_${dateKey}`;

  // 1. Check Cache
  const cached = oddsCache[cacheKey];
  if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
    // We intentionally return cached data but trigger a background context update if needed
    // In a real app we might verify if the cache is stale relative to 'now'
    rawScheduleContext = generateContextString(cached.data, league);
    return cached.data;
  }

  // 2. Determine "Days From" for Scores endpoint
  // The odds endpoint returns upcoming games. The scores endpoint returns recent/live/final.
  // If user requests a date in the past, we need to ask scores for more history.
  const today = new Date();
  today.setHours(0,0,0,0); // Normalize today
  
  const target = new Date(targetDate);
  target.setHours(0,0,0,0);
  
  // Calculate difference in days: (Target - Today) / msPerDay
  const diffTime = Math.abs(target.getTime() - today.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  // If target is in the past, daysFrom needs to cover it. 
  // If target is today or future, daysFrom=1 is usually fine for live scores, 
  // but let's be safe and grab a few days window to handle timezone overlaps.
  const daysFrom = target.getTime() < today.getTime() ? diffDays + 1 : 1;

  try {
    const [scoresResponse, oddsResponse, standingsMap] = await Promise.all([
      fetch(`${API_BASE}/${sportKey}/scores/?daysFrom=${daysFrom}&apiKey=${ODDS_API_KEY}`),
      fetch(`${API_BASE}/${sportKey}/odds/?regions=us&markets=h2h,spreads,totals&oddsFormat=american&apiKey=${ODDS_API_KEY}&bookmakers=draftkings,fanduel,betmgm,williamhill,williamhill_us,caesars`),
      fetchStandings(league)
    ]);
    
    // Allow partial failure (e.g. if scores fail but odds work, show scheduled games)
    const scoresData = scoresResponse.ok ? await scoresResponse.json() : [];
    const oddsData = oddsResponse.ok ? await oddsResponse.json() : [];

    // 3. Merge Strategy: Combine Odds and Scores into a master map
    const gameMap = new Map<string, any>();

    // A. Populate from Odds (Reliable for Scheduled/Upcoming)
    if (Array.isArray(oddsData)) {
      oddsData.forEach((game: any) => {
        gameMap.set(game.id, {
          ...game,
          status: 'Scheduled', // Default for odds endpoint
          scores: [] // Odds endpoint has no scores
        });
      });
    }

    // B. Overlay Scores (Reliable for Live/Final)
    if (Array.isArray(scoresData)) {
      scoresData.forEach((game: any) => {
        const existing = gameMap.get(game.id) || {};
        
        let status = 'Scheduled';
        if (game.completed) status = 'Final';
        else if (game.scores && game.scores.length > 0) status = 'Live'; // Heuristic for live

        gameMap.set(game.id, {
          ...existing, // Keep odds (bookmakers) from previous step if they exist
          ...game,     // Overwrite score info
          status: status
        });
      });
    }

    // 4. Filter for Target Date (Game Day filtering)
    // We use local time matching to respect the user's "Day" perspective.
    const combinedGames = Array.from(gameMap.values()).filter((game: any) => {
        const gameDate = new Date(game.commence_time);
        
        return gameDate.getDate() === target.getDate() &&
               gameDate.getMonth() === target.getMonth() &&
               gameDate.getFullYear() === target.getFullYear();
    });

    // 5. Map to GameData interface
    const mappedGames: GameData[] = combinedGames.map((game: any) => {
      // Bookmakers come from the Odds endpoint data (merged in step A)
      const bookmakers = game.bookmakers || [];

      const dk = bookmakers.find((b: any) => b.key === 'draftkings');
      const fd = bookmakers.find((b: any) => b.key === 'fanduel');
      const mgm = bookmakers.find((b: any) => b.key === 'betmgm');
      const wh = bookmakers.find((b: any) => b.key === 'williamhill' || b.key === 'williamhill_us' || b.key === 'caesars');
      const fallback = bookmakers[0];

      // Extract Scores
      let awayScore = '';
      let homeScore = '';
      if (game.scores) {
        const away = game.scores.find((s: any) => s.name === game.away_team);
        const home = game.scores.find((s: any) => s.name === game.home_team);
        if (away) awayScore = away.score;
        if (home) homeScore = home.score;
        
        if (game.status === 'Live') {
            if (!awayScore) awayScore = '0';
            if (!homeScore) homeScore = '0';
        }
      }

      const awayAbbr = getAbbr(game.away_team, league);
      const homeAbbr = getAbbr(game.home_team, league);

      const gameObj: GameData = {
        id: game.id,
        league: league,
        awayTeam: awayAbbr,
        homeTeam: homeAbbr,
        awayRecord: standingsMap[awayAbbr] || '',
        homeRecord: standingsMap[homeAbbr] || '',
        time: new Date(game.commence_time).toLocaleTimeString('en-US', {hour: 'numeric', minute:'2-digit', timeZoneName: 'short'}),
        timestamp: new Date(game.commence_time).getTime(),
        status: game.status,
        awayScore: awayScore,
        homeScore: homeScore,
        odds: {
          draftkings: extractMarketData(dk, game),
          fanduel: extractMarketData(fd, game),
          betmgm: extractMarketData(mgm, game),
          williamhill: extractMarketData(wh, game),
          generic: extractMarketData(fallback, game)
        }
      };

      return gameObj;
    });

    // Sort by timestamp
    mappedGames.sort((a, b) => a.timestamp - b.timestamp);

    // Update Cache
    oddsCache[cacheKey] = { data: mappedGames, timestamp: Date.now() };
    
    // Update Context for AI (Serialize the data nicely)
    rawScheduleContext = generateContextString(mappedGames, league, targetDate);

    return mappedGames;

  } catch (error) {
    console.error("Failed to fetch from Odds API:", error);
    return [];
  }
};

const generateContextString = (games: GameData[], league: League, date?: Date): string => {
   const dateStr = date ? date.toLocaleDateString() : "Today";
   return games.map(g => {
      const spreadLabel = league === 'NHL' ? 'PL' : 'Spread';
      const header = `${g.awayTeam} ${g.awayRecord ? `(${g.awayRecord})` : ''} @ ${g.homeTeam} ${g.homeRecord ? `(${g.homeRecord})` : ''} | Time: ${g.time} | Status: ${g.status} ${g.status !== 'Scheduled' ? `(Score: ${g.awayScore}-${g.homeScore})` : ''}`;
      
      const bookLines = [];
      const { draftkings, fanduel, betmgm, williamhill } = g.odds;

      if (draftkings && draftkings.awayML !== '-') bookLines.push(`  DK:  ${g.awayTeam} ${draftkings.awayML}/${g.homeTeam} ${draftkings.homeML} | T: ${draftkings.total} | ${spreadLabel}: ${g.awayTeam} ${draftkings.awayPL}/${g.homeTeam} ${draftkings.homePL}`);
      if (fanduel && fanduel.awayML !== '-')    bookLines.push(`  FD:  ${g.awayTeam} ${fanduel.awayML}/${g.homeTeam} ${fanduel.homeML}       | T: ${fanduel.total}`);
      if (betmgm && betmgm.awayML !== '-')     bookLines.push(`  MGM: ${g.awayTeam} ${betmgm.awayML}/${g.homeTeam} ${betmgm.homeML}       | T: ${betmgm.total}`);
      if (williamhill && williamhill.awayML !== '-') bookLines.push(`  CZR: ${g.awayTeam} ${williamhill.awayML}/${g.homeTeam} ${williamhill.homeML}       | T: ${williamhill.total}`);
      
      if (bookLines.length === 0 && g.status === 'Scheduled') bookLines.push('  No odds available currently.');
      if (bookLines.length === 0 && g.status !== 'Scheduled') bookLines.push('  (Odds closed - Game in progress/Final)');

      return `${header}\n${bookLines.join('\n')}`;
    }).join('\n\n');
}

// --- CHAT AI LOGIC ---

const getSystemInstruction = (league: League): string => {
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const spreadTerm = league === 'NHL' ? 'Puck Line' : 'Spread';
  const sportName = league === 'NHL' ? 'NHL' : 'NFL';
  const statContext = league === 'NHL' 
    ? "| GF/G | GA/G | PP% | PK% |" 
    : "| PTS/G | YDS/G | Pass Yds | Rush Yds |";

  return `
You are "SharpEdge," an elite institutional-grade ${sportName} betting analyst.
CURRENT SYSTEM DATE: ${dateStr}
ACTIVE LEAGUE: ${league}

GOAL: Provide decisive, data-backed actionable intelligence. Do not hedge. Do not be vague.

**CORE CAPABILITY: RICH DATA TABLES**
You have the ability to render rich Markdown tables. YOU MUST USE THIS for comparisons.
Whenever you are comparing odds, stats, or line movement, format it as a Markdown table.

**RESPONSE PROTOCOLS:**

1. **LINE SHOPPING REQUESTS** (e.g., "Who has the best price on ${league === 'NHL' ? 'Rangers' : 'Chiefs'}?"):
   - You MUST output a Markdown table comparing the books in your context.
   - Format:
     | Book | ${dateStr} Odds | Edge |
     |---|---|---|
     | DraftKings | -130 | |
     | FanDuel | -120 | ✅ Best Price |
     | BetMGM | -135 | |

2. **MATCHUP ANALYSIS** (e.g., "Analyze the game"):
   - **The Snapshot**: 1-2 sentences setting the stage.
   - **TEAM RECORDS**: Always include team records (found in your context) next to team names in your text.
   - **Tale of the Tape (Mandatory Table)**: Use 'googleSearch' to find these stats:
     | Stat | Away Team | Home Team |
     |---|---|---|
     | Record | ... | ... |
     | L5 Form | ... | ... |
     ${statContext}
   - **The Read**: Analyze the mismatch. Mention specific injuries (use Search).
   - **The Sharp Play**: Conclude with a specific, bold recommendation.

3. **TODAY'S SLATE OVERVIEW**:
   - List the games with their records.
   - **Identify the "Top 3 Edges"** using a table:
     | Matchup | Play | Odds | Logic |
     |---|---|---|---|
     | Team A/B | Team A ${spreadTerm} | -110 | ... |

**DATA HANDLING:**
- **LIVE ODDS**: Use the injected context for DK, FD, MGM, CZR.
- **INJURIES**: YOU MUST SEARCH GOOGLE. The context does not have deep injury reports.
- **NO HALLUCINATIONS**: If you don't see a line in the context, say "No line available."

**TONE:**
- Concise.
- Financial.
- High-conviction.
`;
};

let chatInstance: Chat | null = null;
let genAIInstance: GoogleGenAI | null = null;
let lastLeagueContext: League | null = null;

const getAIClient = (): GoogleGenAI => {
  if (!genAIInstance) {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      throw new Error("API_KEY environment variable is missing.");
    }
    genAIInstance = new GoogleGenAI({ apiKey });
  }
  return genAIInstance;
};

export const initializeChat = (league: League): Chat => {
  if (chatInstance && lastLeagueContext === league) return chatInstance;

  const ai = getAIClient();
  chatInstance = ai.chats.create({
    model: 'gemini-3-pro-preview', 
    config: {
      systemInstruction: getSystemInstruction(league),
      tools: [{ googleSearch: {} }],
    },
  });
  lastLeagueContext = league;
  return chatInstance;
};

export const sendMessageToAI = async (userMessage: string, league: League = 'NHL'): Promise<string> => {
  try {
    // Note: We assume the ScheduleView has already fetched relevant data and populated rawScheduleContext
    // If rawScheduleContext is empty, the AI will just use general knowledge.
    
    const chat = initializeChat(league);
    
    const contextInjection = rawScheduleContext 
      ? `\n[SYSTEM INJECTION - CURRENT ${league} ODDS BOARD & SCORES DATA (Source: The Odds API)]:\n${rawScheduleContext}\n\n[USER MESSAGE]:\n` 
      : ``;

    const response = await chat.sendMessage({ message: contextInjection + userMessage });
    return response.text || "No analysis generated.";
  } catch (error) {
    console.error("Error communicating with Gemini:", error);
    throw error;
  }
};
