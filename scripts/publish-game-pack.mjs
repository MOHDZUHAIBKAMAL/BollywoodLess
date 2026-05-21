import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const require = createRequire(import.meta.url);
const { snippetDurationSeconds } = require('../apps/api/src/config');
const { getSnippetPath } = require('../apps/api/src/services/audioSnippetService');
const {
  getUploadedTracks,
  publicTrack
} = require('../apps/api/src/services/trackRepository');

const snippetsDir = path.join(repoRoot, 'apps', 'web', 'public', 'snippets');
const packPath = path.join(
  repoRoot,
  'apps',
  'web',
  'src',
  'data',
  'published-game-pack.json'
);

async function isPlayableUpload(track) {
  try {
    const stat = await fs.stat(track.full_audio_url);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function cleanPublishedSnippets() {
  await fs.mkdir(snippetsDir, { recursive: true });
  const entries = await fs.readdir(snippetsDir, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.mp3'))
      .map((entry) => fs.unlink(path.join(snippetsDir, entry.name)))
  );
}

async function publishTrack(track) {
  const snippetPath = await getSnippetPath(track);
  const startTime = Math.max(0, Number(track.snippet_start_time) || 0);
  const snippetName = `${track.id}-${startTime}-${snippetDurationSeconds}.mp3`;

  await fs.copyFile(snippetPath, path.join(snippetsDir, snippetName));

  return {
    ...publicTrack(track),
    snippet_url: `/snippets/${snippetName}`
  };
}

async function main() {
  const uploads = await getUploadedTracks();
  const playableChecks = await Promise.all(
    uploads.map(async (track) => ({
      track,
      playable: await isPlayableUpload(track)
    }))
  );
  const playableTracks = playableChecks
    .filter(({ playable }) => playable)
    .map(({ track }) => track);

  if (!playableTracks.length) {
    throw new Error('No playable uploaded MP3 tracks found in the local admin catalog.');
  }

  await cleanPublishedSnippets();
  const tracks = [];

  for (const track of playableTracks) {
    tracks.push(await publishTrack(track));
  }

  await fs.mkdir(path.dirname(packPath), { recursive: true });
  await fs.writeFile(
    packPath,
    `${JSON.stringify(
      {
        version: 1,
        published_at: new Date().toISOString(),
        snippet_duration_seconds: snippetDurationSeconds,
        attempts_per_round: 5,
        tracks
      },
      null,
      2
    )}\n`
  );

  console.log(`Published ${tracks.length} tracks.`);
  console.log(`Metadata: ${path.relative(repoRoot, packPath)}`);
  console.log(`Snippets: ${path.relative(repoRoot, snippetsDir)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
