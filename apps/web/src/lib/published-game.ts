import packJson from '@/data/published-game-pack.json';
import { DailyGameResponse, TrackResult } from '@/lib/api';

export type PublishedTrack = TrackResult & {
  snippet_url: string;
};

type PublishedGamePack = {
  version: number;
  published_at: string;
  snippet_duration_seconds: number;
  attempts_per_round: number;
  tracks: PublishedTrack[];
};

const pack = packJson as PublishedGamePack;
const snippetSteps = [1, 2, 4, 8, 15];

export function getDailyKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function hashString(value: string) {
  return String(value)
    .split('')
    .reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 2166136261);
}

function getGameSignature(dailyKey: string, tracks: PublishedTrack[]) {
  return hashString(
    `${getStorageVersion()}:${dailyKey}:${tracks.map((track) => track.id).join('|')}`
  ).toString(36);
}

function seededSort(key: string, tracks: PublishedTrack[]) {
  return [...tracks].sort((left, right) => {
    const leftHash = hashString(`${key}:${left.id}`);
    const rightHash = hashString(`${key}:${right.id}`);
    return leftHash - rightHash;
  });
}

function normalizedPlayerSeed(playerSeed = '') {
  return playerSeed.trim().slice(0, 128);
}

function getShuffleKey(dailyKey: string, playerSeed = '') {
  const seed = normalizedPlayerSeed(playerSeed);
  return seed ? `${dailyKey}:player:${seed}` : dailyKey;
}

function normalize(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function intersectsNormalized(left: string[], right: string[]) {
  const normalizedRight = new Set(right.map(normalize).filter(Boolean));
  return left.map(normalize).some((value) => value && normalizedRight.has(value));
}

export function getPublishedTracks() {
  return pack.tracks;
}

export function getStorageVersion() {
  return process.env.VERCEL_GIT_COMMIT_SHA || `pack:${pack.version}:${pack.published_at}`;
}

export function getAttemptsPerRound() {
  return pack.attempts_per_round || 5;
}

export function toPublicTrack(track: PublishedTrack) {
  const { snippet_url: _snippetUrl, ...publicTrack } = track;
  return publicTrack;
}

export function getDailyTracks(key = getDailyKey(), playerSeed = '') {
  return seededSort(getShuffleKey(key, playerSeed), pack.tracks);
}

export function getGameTrack(key: string, roundNumber: number, playerSeed = '') {
  return getDailyTracks(key, playerSeed)[roundNumber - 1] || null;
}

export function getGameSummary(dailyKey = getDailyKey(), playerSeed = ''): DailyGameResponse {
  const tracks = getDailyTracks(dailyKey, playerSeed);

  return {
    dailyKey,
    gameSignature: getGameSignature(dailyKey, tracks),
    storageVersion: getStorageVersion(),
    roundCount: tracks.length,
    targetRoundCount: tracks.length,
    needsTracks: 0,
    attemptsPerRound: getAttemptsPerRound(),
    maxSnippetSeconds: pack.snippet_duration_seconds || 15,
    snippetSeconds: snippetSteps,
    rounds: tracks.map((track, index) => ({
      roundNumber: index + 1,
      snippetUrl: track.snippet_url
    }))
  };
}

export function searchPublishedTracks(query: string, limit = 10) {
  const normalizedQuery = normalize(query);

  if (normalizedQuery.length < 2) {
    return [];
  }

  return pack.tracks
    .map((track) => {
      const title = normalize(track.song_title);
      const album = normalize(track.movie_album);
      const artists = normalize(track.artists.join(' '));
      const haystack = `${title} ${album} ${artists}`;

      if (!haystack.includes(normalizedQuery)) {
        return null;
      }

      let score = 0;
      if (title.startsWith(normalizedQuery)) score += 40;
      if (title.includes(normalizedQuery)) score += 20;
      if (artists.includes(normalizedQuery)) score += 10;
      if (album.includes(normalizedQuery)) score += 5;

      return { score, track };
    })
    .filter((result): result is { score: number; track: PublishedTrack } => Boolean(result))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ track }) => toPublicTrack(track));
}

function sameProviderTrack(answer: TrackResult, guess: TrackResult) {
  return Boolean(
    answer.provider &&
      guess.provider &&
      answer.provider === guess.provider &&
      answer.provider_track_id &&
      guess.provider_track_id &&
      answer.provider_track_id === guess.provider_track_id
  );
}

function sameIsrc(answer: TrackResult, guess: TrackResult) {
  return Boolean(answer.isrc && guess.isrc && normalize(answer.isrc) === normalize(guess.isrc));
}

function sameArtist(answer: TrackResult, guess: TrackResult) {
  const answerArtistIds = answer.artist_ids || [];
  const guessArtistIds = guess.artist_ids || [];
  const hasSameArtistId = answerArtistIds.some((id) => guessArtistIds.includes(id));

  return hasSameArtistId || intersectsNormalized(answer.artists || [], guess.artists || []);
}

export function evaluateGuess(answer: TrackResult, guess: TrackResult | null) {
  if (!guess) {
    return 'skipped';
  }

  if (answer.id === guess.id || sameProviderTrack(answer, guess) || sameIsrc(answer, guess)) {
    return 'correct';
  }

  if (sameArtist(answer, guess)) {
    return 'artist';
  }

  return 'wrong';
}
