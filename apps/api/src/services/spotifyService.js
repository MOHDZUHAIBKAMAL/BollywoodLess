const {
  spotifyClientId,
  spotifyClientSecret,
  spotifyMarket
} = require('../config');

let tokenCache = {
  accessToken: '',
  expiresAt: 0
};

function isSpotifyConfigured() {
  return Boolean(spotifyClientId && spotifyClientSecret);
}

async function getSpotifyToken() {
  if (!isSpotifyConfigured()) {
    return '';
  }

  if (tokenCache.accessToken && tokenCache.expiresAt > Date.now() + 30_000) {
    return tokenCache.accessToken;
  }

  const credentials = Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString('base64');
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' })
  });

  if (!response.ok) {
    const error = new Error('Spotify token request failed');
    error.statusCode = 502;
    throw error;
  }

  const payload = await response.json();
  tokenCache = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000
  };

  return tokenCache.accessToken;
}

function mapSpotifyTrack(track) {
  const releaseYear = track.album?.release_date
    ? String(track.album.release_date).slice(0, 4)
    : '';

  return {
    id: `spotify:${track.id}`,
    song_title: track.name,
    movie_album: track.album?.name || 'Unknown album',
    artists: (track.artists || []).map((artist) => artist.name),
    label: `${track.name} - ${track.album?.name || 'Unknown album'}`,
    provider: 'spotify',
    provider_track_id: track.id,
    artist_ids: (track.artists || []).map((artist) => artist.id),
    isrc: track.external_ids?.isrc || '',
    artwork_url: track.album?.images?.[0]?.url || '',
    provider_url: track.external_urls?.spotify || '',
    release_year: releaseYear
  };
}

async function searchSpotifyTracks(query, limit = 8) {
  if (!isSpotifyConfigured() || query.trim().length < 2) {
    return {
      configured: isSpotifyConfigured(),
      results: []
    };
  }

  const token = await getSpotifyToken();
  const spotifyLimit = Math.min(Math.max(Number(limit) || 8, 1), 10);
  const params = new URLSearchParams({
    q: query,
    type: 'track',
    limit: String(spotifyLimit),
    market: spotifyMarket
  });

  const response = await fetch(`https://api.spotify.com/v1/search?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const error = new Error('Spotify search failed');
    error.statusCode = 502;
    error.details = {
      status: response.status,
      body: (await response.text()).slice(0, 300)
    };
    throw error;
  }

  const payload = await response.json();

  return {
    configured: true,
    results: (payload.tracks?.items || []).map(mapSpotifyTrack)
  };
}

module.exports = {
  isSpotifyConfigured,
  searchSpotifyTracks
};
