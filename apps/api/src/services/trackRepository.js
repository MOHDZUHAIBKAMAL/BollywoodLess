const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const { snippetCacheDir, trackDbPath, uploadRoot } = require('../config');
const { seedTracks } = require('../data/seedTracks');

let writeQueue = Promise.resolve();

function publicTrack(track) {
  return {
    id: track.id,
    song_title: track.song_title,
    movie_album: track.movie_album,
    artists: track.artists || [],
    label: `${track.song_title} - ${track.movie_album}`,
    provider: track.provider || 'manual',
    provider_track_id: track.provider_track_id || '',
    artist_ids: track.artist_ids || [],
    isrc: track.isrc || '',
    artwork_url: track.artwork_url || '',
    provider_url: track.provider_url || '',
    release_year: track.release_year || '',
    difficulty: track.difficulty || 'medium',
    snippet_start_time: Number(track.snippet_start_time) || 0
  };
}

async function ensureDb() {
  await fs.mkdir(require('path').dirname(trackDbPath), { recursive: true });

  try {
    await fs.access(trackDbPath);
  } catch {
    await fs.writeFile(trackDbPath, '[]\n');
  }
}

async function readUploadedTracks() {
  await ensureDb();
  const raw = await fs.readFile(trackDbPath, 'utf8');
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

async function writeUploadedTracks(tracks) {
  await ensureDb();
  await fs.writeFile(trackDbPath, `${JSON.stringify(tracks, null, 2)}\n`);
}

async function getAllTracks() {
  const uploaded = await readUploadedTracks();
  return [...seedTracks, ...uploaded];
}

async function getUploadedTracks() {
  return readUploadedTracks();
}

async function findTrackById(id) {
  const tracks = await getAllTracks();
  return tracks.find((track) => track.id === id);
}

async function addUploadedTrack(input) {
  const now = new Date().toISOString();
  const track = {
    id: randomUUID(),
    song_title: input.song_title,
    movie_album: input.movie_album,
    artists: input.artists,
    full_audio_url: input.full_audio_url,
    snippet_start_time: input.snippet_start_time,
    provider: input.provider || 'manual',
    provider_track_id: input.provider_track_id || '',
    provider_url: input.provider_url || '',
    artist_ids: input.artist_ids || [],
    isrc: input.isrc || '',
    artwork_url: input.artwork_url || '',
    release_year: input.release_year || '',
    difficulty: input.difficulty || 'medium',
    original_file_name: input.original_file_name || '',
    source: 'uploaded',
    created_at: now,
    updated_at: now
  };

  writeQueue = writeQueue.then(async () => {
    const tracks = await readUploadedTracks();
    tracks.push(track);
    await writeUploadedTracks(tracks);
  });

  await writeQueue;
  return track;
}

async function updateUploadedTrack(id, input) {
  let updatedTrack = null;

  writeQueue = writeQueue.then(async () => {
    const tracks = await readUploadedTracks();
    const index = tracks.findIndex((track) => track.id === id);

    if (index < 0) {
      return;
    }

    updatedTrack = {
      ...tracks[index],
      song_title: input.song_title,
      movie_album: input.movie_album,
      artists: input.artists,
      snippet_start_time: input.snippet_start_time,
      provider: input.provider || 'manual',
      provider_track_id: input.provider_track_id || '',
      provider_url: input.provider_url || '',
      artist_ids: input.artist_ids || [],
      isrc: input.isrc || '',
      artwork_url: input.artwork_url || '',
      release_year: input.release_year || '',
      difficulty: input.difficulty || 'medium',
      updated_at: new Date().toISOString()
    };

    tracks[index] = updatedTrack;
    await writeUploadedTracks(tracks);
  });

  await writeQueue;

  if (updatedTrack) {
    await removeCachedSnippets(updatedTrack.id);
  }

  return updatedTrack;
}

function isInside(basePath, targetPath) {
  const relative = path.relative(basePath, targetPath);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function removeCachedSnippets(trackId) {
  const files = await fs.readdir(snippetCacheDir).catch(() => []);

  await Promise.all(
    files
      .filter((file) => file.startsWith(`${trackId}-`) && file.endsWith('.mp3'))
      .map((file) => fs.unlink(path.join(snippetCacheDir, file)).catch(() => {}))
  );
}

async function deleteUploadedTrack(id) {
  let deletedTrack = null;

  writeQueue = writeQueue.then(async () => {
    const tracks = await readUploadedTracks();
    const nextTracks = tracks.filter((track) => {
      if (track.id === id) {
        deletedTrack = track;
        return false;
      }

      return true;
    });

    if (deletedTrack) {
      await writeUploadedTracks(nextTracks);
    }
  });

  await writeQueue;

  if (!deletedTrack) {
    return null;
  }

  const audioPath = path.resolve(deletedTrack.full_audio_url || '');
  const fullUploadRoot = path.resolve(uploadRoot, 'full');

  if (isInside(fullUploadRoot, audioPath)) {
    await fs.unlink(audioPath).catch(() => {});
  }

  await removeCachedSnippets(deletedTrack.id);

  return deletedTrack;
}

module.exports = {
  addUploadedTrack,
  deleteUploadedTrack,
  findTrackById,
  getAllTracks,
  getUploadedTracks,
  publicTrack,
  updateUploadedTrack
};
