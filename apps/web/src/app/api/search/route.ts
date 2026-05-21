import { TrackResult } from '@/lib/api';
import { searchPublishedTracks } from '@/lib/published-game';
import { isSpotifyConfigured, searchSpotifyTracks } from '@/lib/spotify-server';

export const runtime = 'nodejs';

function dedupeResults(results: TrackResult[]) {
  const seen = new Set<string>();

  return results.filter((track) => {
    const key = track.provider_track_id
      ? `${track.provider}:${track.provider_track_id}`
      : track.id;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q') || '';

  try {
    const [localResults, spotifyResults] = await Promise.all([
      searchPublishedTracks(query),
      searchSpotifyTracks(query)
    ]);

    return Response.json({
      providerConfigured: isSpotifyConfigured(),
      results: dedupeResults([...localResults, ...spotifyResults]).slice(0, 10)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Catalog search failed';
    return Response.json({ error: message }, { status: 502 });
  }
}
