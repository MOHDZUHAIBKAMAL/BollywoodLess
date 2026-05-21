const { searchLocalTracks } = require('./trackService');
const { isSpotifyConfigured, searchSpotifyTracks } = require('./spotifyService');

function dedupeResults(results) {
  const seen = new Set();

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

async function searchCatalog(query, limit = 10) {
  const [localResults, spotifyPayload] = await Promise.all([
    searchLocalTracks(query, limit),
    searchSpotifyTracks(query, limit)
  ]);

  return {
    providerConfigured: isSpotifyConfigured(),
    results: dedupeResults([...localResults, ...spotifyPayload.results]).slice(0, limit)
  };
}

module.exports = {
  searchCatalog
};
