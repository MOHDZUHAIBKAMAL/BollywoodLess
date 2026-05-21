const path = require('path');

const apiRoot = path.resolve(__dirname, '..');

const configuredCorsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function isAllowedCorsOrigin(origin) {
  if (!origin) {
    return true;
  }

  if (configuredCorsOrigins.includes('*') || configuredCorsOrigins.includes(origin)) {
    return true;
  }

  try {
    const url = new URL(origin);
    return (
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.hostname.endsWith('.trycloudflare.com')
    );
  } catch {
    return false;
  }
}

const config = {
  port: Number(process.env.PORT || 4000),
  corsOrigin: configuredCorsOrigins,
  isAllowedCorsOrigin,
  snippetDurationSeconds: Number(process.env.SNIPPET_DURATION_SECONDS || 15),
  attemptsPerRound: Number(process.env.ATTEMPTS_PER_ROUND || 5),
  dailyRoundCount: Number(process.env.DAILY_ROUND_COUNT || 0),
  adminUsername: process.env.ADMIN_USERNAME || 'zubi',
  adminPassword: process.env.ADMIN_PASSWORD || 'lenihai',
  snippetCacheDir: process.env.SNIPPET_CACHE_DIR
    ? path.resolve(process.env.SNIPPET_CACHE_DIR)
    : path.resolve(apiRoot, 'snippets'),
  audioRoot: process.env.AUDIO_ROOT
    ? path.resolve(process.env.AUDIO_ROOT)
    : path.resolve(apiRoot, 'audio'),
  uploadRoot: process.env.UPLOAD_ROOT
    ? path.resolve(process.env.UPLOAD_ROOT)
    : path.resolve(apiRoot, 'uploads'),
  trackDbPath: process.env.TRACK_DB_PATH
    ? path.resolve(process.env.TRACK_DB_PATH)
    : path.resolve(apiRoot, 'storage', 'tracks.json'),
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID || '',
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
  spotifyMarket: process.env.SPOTIFY_MARKET || 'IN'
};

module.exports = config;
