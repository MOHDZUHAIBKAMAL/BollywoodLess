import {
  getLeaderboard,
  submitLeaderboardEntry,
  type LeaderboardScope
} from '@/lib/leaderboard-store';
import { getDailyKey, getGameSummary } from '@/lib/published-game';

export const runtime = 'nodejs';

type LeaderboardPayload = {
  playerName?: string;
  playerSeed?: string;
  dailyKey?: string;
  gameSignature?: string;
  score?: number;
  maxScore?: number;
  solvedCount?: number;
  roundCount?: number;
};

function scopeFromQuery(value: string | null): LeaderboardScope {
  return value === 'allTime' ? 'allTime' : 'daily';
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const dailyKey = query.get('dailyKey') || getDailyKey();
  const scope = scopeFromQuery(query.get('scope'));
  const summary = getGameSummary(dailyKey);
  const maxScore = summary.roundCount * 5;

  try {
    const leaderboard = await getLeaderboard(scope, dailyKey, maxScore, summary.roundCount);
    return Response.json(leaderboard);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Leaderboard could not be loaded.';
    return Response.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as LeaderboardPayload | null;

  if (
    !payload?.playerName ||
    !payload.playerSeed ||
    !payload.dailyKey ||
    !payload.gameSignature ||
    typeof payload.score !== 'number' ||
    typeof payload.maxScore !== 'number' ||
    typeof payload.solvedCount !== 'number' ||
    typeof payload.roundCount !== 'number'
  ) {
    return Response.json({ error: 'Invalid leaderboard payload.' }, { status: 400 });
  }

  const summary = getGameSummary(payload.dailyKey, payload.playerSeed);

  if (summary.gameSignature !== payload.gameSignature) {
    return Response.json({ error: 'Leaderboard game signature mismatch.' }, { status: 409 });
  }

  try {
    const entry = await submitLeaderboardEntry({
      playerName: payload.playerName,
      playerSeed: payload.playerSeed,
      dailyKey: payload.dailyKey,
      gameSignature: payload.gameSignature,
      score: payload.score,
      maxScore: payload.maxScore,
      solvedCount: payload.solvedCount,
      roundCount: payload.roundCount
    });

    return Response.json({ entry });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Leaderboard score could not be saved.';
    return Response.json({ error: message }, { status: 502 });
  }
}
