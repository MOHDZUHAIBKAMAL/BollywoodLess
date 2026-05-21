const fs = require('fs/promises');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { snippetCacheDir, snippetDurationSeconds } = require('../config');

function isRemoteUrl(value) {
  return /^https?:\/\//i.test(value);
}

async function ensureLocalSourceExists(source) {
  if (isRemoteUrl(source)) {
    return;
  }

  try {
    await fs.access(source);
  } catch {
    const error = new Error(`Audio source not found: ${source}`);
    error.statusCode = 404;
    error.code = 'AUDIO_SOURCE_MISSING';
    throw error;
  }
}

async function fileExists(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.size > 0;
  } catch {
    return false;
  }
}

function renderSnippet({ input, outputPath, startTime, duration }) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .setStartTime(startTime)
      .duration(duration)
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .format('mp3')
      .outputOptions(['-vn', '-map_metadata', '-1'])
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

async function getSnippetPath(track) {
  await fs.mkdir(snippetCacheDir, { recursive: true });

  const startTime = Math.max(0, Number(track.snippet_start_time) || 0);
  const cacheName = `${track.id}-${startTime}-${snippetDurationSeconds}.mp3`;
  const cachedPath = path.join(snippetCacheDir, cacheName);

  if (await fileExists(cachedPath)) {
    return cachedPath;
  }

  await ensureLocalSourceExists(track.full_audio_url);

  const tempPath = `${cachedPath}.tmp-${Date.now()}`;

  try {
    await renderSnippet({
      input: track.full_audio_url,
      outputPath: tempPath,
      startTime,
      duration: snippetDurationSeconds
    });

    await fs.rename(tempPath, cachedPath);
    return cachedPath;
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    error.statusCode = error.statusCode || 500;
    throw error;
  }
}

module.exports = {
  getSnippetPath
};
