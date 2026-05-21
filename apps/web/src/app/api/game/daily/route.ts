import { getDailyKey, getGameSummary } from '@/lib/published-game';

export const runtime = 'nodejs';

export function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const dailyKey = query.get('date') || getDailyKey();

  return Response.json(getGameSummary(dailyKey));
}
