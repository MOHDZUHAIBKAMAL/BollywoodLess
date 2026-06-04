import { getDailyKey } from '@/lib/published-game';

export type LeaderboardEntry = {
  id: string;
  playerName: string;
  score: number;
  maxScore: number;
  solvedCount: number;
  roundCount: number;
  dailyKey: string;
  submittedAt: string;
  isSeeded?: boolean;
};

export type LeaderboardScope = 'daily' | 'allTime';

const leaderboardPrefix = 'bollywoodless:leaderboard';
const maxEntries = 25;

function redisUrl() {
  return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
}

function redisToken() {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
}

export function isLeaderboardStoreConfigured() {
  return Boolean(redisUrl() && redisToken());
}

function keyForScope(scope: LeaderboardScope, dailyKey = getDailyKey()) {
  return scope === 'daily'
    ? `${leaderboardPrefix}:daily:${dailyKey}`
    : `${leaderboardPrefix}:all-time`;
}

function seededEntry(dailyKey: string, maxScore: number, roundCount: number): LeaderboardEntry {
  return {
    id: `seed:zubi:${dailyKey}`,
    playerName: 'zubi',
    score: maxScore,
    maxScore,
    solvedCount: roundCount,
    roundCount,
    dailyKey,
    submittedAt: new Date(0).toISOString(),
    isSeeded: true
  };
}

async function redisCommand<T>(command: unknown[]) {
  const response = await fetch(redisUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redisToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command),
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Leaderboard store failed: ${response.status}`);
  }

  const payload = (await response.json()) as { result?: T; error?: string };

  if (payload.error) {
    throw new Error(payload.error);
  }

  return payload.result as T;
}

function normalizeName(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 28) || 'Anonymous';
}

function normalizeEntry(input: {
  playerName: string;
  score: number;
  maxScore: number;
  solvedCount: number;
  roundCount: number;
  dailyKey: string;
  gameSignature: string;
  playerSeed: string;
}) {
  const maxScore = Math.max(0, Math.min(Number(input.maxScore) || 0, 500));
  const roundCount = Math.max(0, Math.min(Number(input.roundCount) || 0, 100));
  const score = Math.max(0, Math.min(Number(input.score) || 0, maxScore));
  const solvedCount = Math.max(0, Math.min(Number(input.solvedCount) || 0, roundCount));
  const submittedAt = new Date().toISOString();
  const playerSeed = input.playerSeed.trim().slice(0, 128);
  const gameSignature = input.gameSignature.trim().slice(0, 80);

  return {
    id: `${input.dailyKey}:${gameSignature}:${playerSeed}:${submittedAt}`,
    playerName: normalizeName(input.playerName),
    score,
    maxScore,
    solvedCount,
    roundCount,
    dailyKey: input.dailyKey || getDailyKey(),
    submittedAt
  } satisfies LeaderboardEntry;
}

export async function submitLeaderboardEntry(input: {
  playerName: string;
  score: number;
  maxScore: number;
  solvedCount: number;
  roundCount: number;
  dailyKey: string;
  gameSignature: string;
  playerSeed: string;
}) {
  const entry = normalizeEntry(input);

  if (!isLeaderboardStoreConfigured()) {
    return entry;
  }

  const member = JSON.stringify(entry);
  await Promise.all([
    redisCommand(['ZADD', keyForScope('daily', entry.dailyKey), entry.score, member]),
    redisCommand(['ZADD', keyForScope('allTime'), entry.score, member]),
    redisCommand(['EXPIRE', keyForScope('daily', entry.dailyKey), 60 * 60 * 24 * 14])
  ]);

  return entry;
}

function parseStoredEntries(values: string[] | null | undefined) {
  const entries: LeaderboardEntry[] = [];

  for (let index = 0; index < (values?.length || 0); index += 2) {
    const raw = values?.[index];
    const score = Number(values?.[index + 1] || 0);

    if (!raw) continue;

    try {
      const entry = JSON.parse(raw) as LeaderboardEntry;
      entries.push({
        ...entry,
        score: Number.isFinite(score) ? score : entry.score
      });
    } catch {
      // Ignore malformed historical rows.
    }
  }

  return entries;
}

export async function getLeaderboard(scope: LeaderboardScope, dailyKey: string, maxScore: number, roundCount: number) {
  const seeded = seededEntry(dailyKey, maxScore, roundCount);

  if (!isLeaderboardStoreConfigured()) {
    return {
      configured: false,
      entries: [seeded]
    };
  }

  const rawEntries = await redisCommand<string[]>([
    'ZREVRANGE',
    keyForScope(scope, dailyKey),
    0,
    maxEntries - 1,
    'WITHSCORES'
  ]);

  const entries = [seeded, ...parseStoredEntries(rawEntries)]
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.submittedAt.localeCompare(right.submittedAt);
    })
    .slice(0, maxEntries);

  return {
    configured: true,
    entries
  };
}
