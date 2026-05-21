import { GuessResponse, GuessStatus, TrackResult } from '@/lib/api';
import {
  evaluateGuess,
  getAttemptsPerRound,
  getDailyKey,
  getGameTrack,
  toPublicTrack
} from '@/lib/published-game';

export const runtime = 'nodejs';

type GuessPayload = {
  dailyKey?: string;
  roundNumber?: number;
  attempt?: number;
  guess?: TrackResult;
  skipped?: boolean;
};

const colorByStatus: Record<GuessStatus, string> = {
  correct: '#55B725',
  artist: '#DAC316',
  wrong: '#C62121',
  skipped: '#2A2E31'
};

function isGuessTrack(value: unknown): value is TrackResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const track = value as Partial<TrackResult>;
  return Boolean(
    typeof track.id === 'string' &&
      typeof track.song_title === 'string' &&
      typeof track.movie_album === 'string' &&
      Array.isArray(track.artists)
  );
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as GuessPayload | null;
  const roundNumber = Number(payload?.roundNumber);
  const attempt = Number(payload?.attempt);

  if (
    !payload ||
    !Number.isInteger(roundNumber) ||
    roundNumber < 1 ||
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    attempt > getAttemptsPerRound()
  ) {
    return Response.json({ error: 'Invalid guess payload.' }, { status: 400 });
  }

  const dailyKey = payload.dailyKey || getDailyKey();
  const answer = getGameTrack(dailyKey, roundNumber);

  if (!answer) {
    return Response.json({ error: 'Round answer not found.' }, { status: 404 });
  }

  const guess = payload.skipped ? null : payload.guess;

  if (!payload.skipped && !isGuessTrack(guess)) {
    return Response.json({ error: 'Choose a search result before guessing.' }, { status: 404 });
  }

  const status = evaluateGuess(toPublicTrack(answer), guess || null) as GuessStatus;
  const didReveal = status === 'correct' || attempt >= getAttemptsPerRound();
  const response: GuessResponse = {
    status,
    color: colorByStatus[status],
    roundState: didReveal ? 'revealed' : 'playing',
    guess: guess || null,
    correctAnswer: didReveal ? toPublicTrack(answer) : null
  };

  return Response.json(response);
}
