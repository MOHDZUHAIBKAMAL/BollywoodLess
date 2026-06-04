export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export type TrackResult = {
  id: string;
  song_title: string;
  movie_album: string;
  artists: string[];
  label: string;
  provider: string;
  provider_track_id: string;
  artist_ids: string[];
  isrc: string;
  artwork_url: string;
  provider_url: string;
  release_year: string;
  difficulty: 'easy' | 'medium' | 'hard';
  snippet_start_time: number;
};

export type GameRound = {
  roundNumber: number;
  snippetUrl: string;
};

export type DailyGameResponse = {
  dailyKey: string;
  gameSignature: string;
  storageVersion: string;
  roundCount: number;
  targetRoundCount: number;
  needsTracks: number;
  attemptsPerRound: number;
  maxSnippetSeconds: number;
  snippetSeconds: number[];
  rounds: GameRound[];
};

export type GuessStatus = 'correct' | 'artist' | 'wrong' | 'skipped';

export type GuessResponse = {
  status: GuessStatus;
  color: string;
  roundState: 'playing' | 'revealed';
  guess: TrackResult | null;
  correctAnswer: TrackResult | null;
};

export type SearchResponse = {
  providerConfigured: boolean;
  results: TrackResult[];
};

export function apiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${API_BASE_URL}${path}`;
}

async function getResponseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null);

  if (payload && typeof payload.error === 'string') {
    return `${fallback}: ${payload.error}`;
  }

  return `${fallback}: ${response.status}`;
}

export async function fetchDailyGame(playerSeed?: string) {
  const params = new URLSearchParams();

  if (playerSeed) {
    params.set('seed', playerSeed);
  }

  const query = params.size ? `?${params.toString()}` : '';
  const response = await fetch(apiUrl(`/api/game/daily${query}`), {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response, 'Unable to load daily game'));
  }

  return response.json() as Promise<DailyGameResponse>;
}

export async function searchTracks(query: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query });
  const response = await fetch(apiUrl(`/api/search?${params.toString()}`), {
    signal
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response, 'Search failed'));
  }

  const payload = (await response.json()) as SearchResponse;
  return payload.results;
}

export async function searchAdminCatalog(query: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query });
  const response = await fetch(apiUrl(`/api/admin/catalog/search?${params.toString()}`), {
    signal
  });

  if (!response.ok) {
    throw new Error('Catalog search failed');
  }

  return response.json() as Promise<SearchResponse>;
}

export async function fetchAdminTracks() {
  const response = await fetch(apiUrl('/api/admin/tracks'), {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error('Unable to load uploaded tracks');
  }

  return response.json() as Promise<{ tracks: TrackResult[] }>;
}

export async function uploadAdminTrack(formData: FormData) {
  const response = await fetch(apiUrl('/api/admin/tracks'), {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Track upload failed');
  }

  return response.json() as Promise<{ track: TrackResult }>;
}

export async function updateAdminTrack(
  trackId: string,
  payload: {
    song_title: string;
    movie_album: string;
    artists: string;
    snippet_start_time: string;
    provider: string;
    provider_track_id: string;
    provider_url: string;
    artist_ids: string[];
    isrc: string;
    artwork_url: string;
    release_year: string;
    difficulty: 'easy' | 'medium' | 'hard';
  }
) {
  const response = await fetch(apiUrl(`/api/admin/tracks/${trackId}`), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ...payload,
      artist_ids: JSON.stringify(payload.artist_ids)
    })
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    throw new Error(errorPayload.error || 'Track update failed');
  }

  return response.json() as Promise<{ track: TrackResult }>;
}

export async function deleteAdminTrack(trackId: string) {
  const response = await fetch(apiUrl(`/api/admin/tracks/${trackId}`), {
    method: 'DELETE'
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Track delete failed');
  }

  return response.json() as Promise<{ deleted: boolean; track: TrackResult }>;
}

export function adminTrackPreviewUrl(trackId: string, startSecond: string | number) {
  const params = new URLSearchParams({
    start: String(startSecond || 0)
  });

  return apiUrl(`/api/admin/tracks/${trackId}/preview?${params.toString()}`);
}

export async function submitGuess(payload: {
  dailyKey: string;
  playerSeed?: string;
  roundNumber: number;
  attempt: number;
  guess?: TrackResult;
  skipped?: boolean;
}) {
  const response = await fetch(apiUrl('/api/guess'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await getResponseError(response, 'Guess could not be submitted'));
  }

  return response.json() as Promise<GuessResponse>;
}
