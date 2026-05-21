import { TrackResult } from '@/lib/api';

const spotifyMarket = process.env.SPOTIFY_MARKET || 'IN';
let tokenCache = {
  accessToken: '',
  expiresAt: 0
};

export function isSpotifyConfigured() {
  return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

async function getSpotifyToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return '';
  }

  if (tokenCache.accessToken && tokenCache.expiresAt > Date.now() + 30_000) {
    return tokenCache.accessToken;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Spotify token request failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  tokenCache = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000
  };

  return tokenCache.accessToken;
}

type SpotifyTrack = {
  id: string;
  name: string;
  artists?: { id: string; name: string }[];
  album?: {
    name?: string;
    release_date?: string;
    images?: { url: string }[];
  };
  external_ids?: {
    isrc?: string;
  };
  external_urls?: {
    spotify?: string;
  };
};

function mapSpotifyTrack(track: SpotifyTrack): TrackResult {
  const albumName = track.album?.name || 'Unknown album';

  return {
    id: `spotify:${track.id}`,
    song_title: track.name,
    movie_album: albumName,
    artists: (track.artists || []).map((artist) => artist.name),
    label: `${track.name} - ${albumName}`,
    provider: 'spotify',
    provider_track_id: track.id,
    artist_ids: (track.artists || []).map((artist) => artist.id),
    isrc: track.external_ids?.isrc || '',
    artwork_url: track.album?.images?.[0]?.url || '',
    provider_url: track.external_urls?.spotify || '',
    release_year: track.album?.release_date?.slice(0, 4) || '',
    difficulty: 'medium',
    snippet_start_time: 0
  };
}

export async function searchSpotifyTracks(query: string, limit = 10) {
  if (!isSpotifyConfigured() || query.trim().length < 2) {
    return [];
  }

  const accessToken = await getSpotifyToken();
  const params = new URLSearchParams({
    q: query,
    type: 'track',
    limit: String(Math.min(Math.max(limit, 1), 10)),
    market: spotifyMarket
  });
  const response = await fetch(`https://api.spotify.com/v1/search?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Spotify search failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    tracks?: {
      items?: SpotifyTrack[];
    };
  };

  return (payload.tracks?.items || []).map(mapSpotifyTrack);
}
