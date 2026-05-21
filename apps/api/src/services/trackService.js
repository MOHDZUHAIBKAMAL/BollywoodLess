const fs = require('fs/promises');
const { attemptsPerRound, dailyRoundCount, snippetDurationSeconds } = require('../config');
const {
  findTrackById,
  getAllTracks,
  publicTrack
} = require('./trackRepository');
const { intersectsNormalized, normalize } = require('../utils/normalize');

const snippetSteps = [1, 2, 4, 8, 15];

function getDailyKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function hashString(value) {
  return String(value)
    .split('')
    .reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 2166136261);
}

function getGameSignature(dailyKey, rounds) {
  return hashString(`${dailyKey}:${rounds.map((track) => track.id).join('|')}`).toString(36);
}

function seededSort(key, tracks) {
  return [...tracks].sort((left, right) => {
    const leftHash = hashString(`${key}:${left.id}`);
    const rightHash = hashString(`${key}:${right.id}`);
    return leftHash - rightHash;
  });
}

async function sourceExists(track) {
  if (/^https?:\/\//i.test(track.full_audio_url || '')) {
    return true;
  }

  try {
    const stats = await fs.stat(track.full_audio_url);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function getPlayableTracks() {
  const tracks = await getAllTracks();
  const checks = await Promise.all(
    tracks.map(async (track) => ({
      track,
      exists: await sourceExists(track)
    }))
  );

  return checks.filter((check) => check.exists).map((check) => check.track);
}

async function getDailyTracks(key = getDailyKey(), limit = dailyRoundCount) {
  const playable = await getPlayableTracks();
  const sorted = seededSort(key, playable);

  return limit > 0 ? sorted.slice(0, limit) : sorted;
}

async function getGameTrack({ key = getDailyKey(), roundNumber = 1 }) {
  const tracks = await getDailyTracks(key);
  return tracks[roundNumber - 1] || null;
}

async function getDailyTrack(key = getDailyKey()) {
  const tracks = await getDailyTracks(key, 1);
  return tracks[0] || null;
}

async function searchLocalTracks(query, limit = 8) {
  const normalizedQuery = normalize(query);

  if (normalizedQuery.length < 2) {
    return [];
  }

  const tracks = await getAllTracks();

  return tracks
    .map((track) => {
      const title = normalize(track.song_title);
      const album = normalize(track.movie_album);
      const artists = normalize((track.artists || []).join(' '));
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
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ track }) => publicTrack(track));
}

function sameProviderTrack(answer, guess) {
  return Boolean(
    answer.provider &&
      guess.provider &&
      answer.provider === guess.provider &&
      answer.provider_track_id &&
      guess.provider_track_id &&
      answer.provider_track_id === guess.provider_track_id
  );
}

function sameIsrc(answer, guess) {
  return Boolean(answer.isrc && guess.isrc && normalize(answer.isrc) === normalize(guess.isrc));
}

function sameArtist(answer, guess) {
  const answerArtistIds = answer.artist_ids || [];
  const guessArtistIds = guess.artist_ids || [];
  const hasSameArtistId = answerArtistIds.some((id) => guessArtistIds.includes(id));

  return (
    hasSameArtistId ||
    intersectsNormalized(answer.artists || [], guess.artists || [])
  );
}

function evaluateGuess(answer, guess) {
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

function getGameSummary({ dailyKey, rounds }) {
  return {
    dailyKey,
    gameSignature: getGameSignature(dailyKey, rounds),
    roundCount: rounds.length,
    targetRoundCount: dailyRoundCount > 0 ? dailyRoundCount : rounds.length,
    needsTracks: dailyRoundCount > 0 ? Math.max(dailyRoundCount - rounds.length, 0) : 0,
    attemptsPerRound,
    maxSnippetSeconds: snippetDurationSeconds,
    snippetSeconds: snippetSteps,
    rounds: rounds.map((track, index) => ({
      roundNumber: index + 1,
      snippetUrl: `/api/game/daily/round/${index + 1}/snippet?key=${encodeURIComponent(dailyKey)}`
    }))
  };
}

module.exports = {
  evaluateGuess,
  findTrackById,
  getDailyKey,
  getDailyTrack,
  getDailyTracks,
  getGameSummary,
  getGameTrack,
  publicTrack,
  searchLocalTracks,
  snippetSteps
};
