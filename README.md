# Bollywoodless

A dark-mode Heardle/Songless-style clone for Bollywood songs. The app is split into:

- `apps/web`: Next.js, React, Tailwind CSS frontend.
- `apps/api`: Express backend with admin uploads, catalog search, 15-round game selection, guess validation, and FFmpeg-backed 15-second snippet generation.

## Prerequisites

- Node.js 20+
- FFmpeg installed and available on `PATH`

## Setup

```bash
npm install
npm run dev
```

The frontend runs at `http://localhost:3000` and the API runs at `http://localhost:4000`.

## Admin Uploads

Open `http://localhost:3000/admin` to add songs to the answer pool.

- Local admin credentials default to `zubi` / `lenihai`.
- Search/select song metadata from Spotify when credentials are configured.
- Fill metadata manually when Spotify is not configured.
- Upload the complete licensed MP3.
- Set `snippet_start_time` to control where the 15-second game clip starts.
- Tag each song difficulty as easy, medium, or hard.

Uploaded full MP3 files are stored under `apps/api/uploads/full` and are ignored by Git. The backend never serves full files directly. It renders and caches only the configured 15-second slice.

Uploaded track metadata is stored in `apps/api/storage/tracks.json`.

## Vercel Player Pack

The deployed player does not need uploaded full songs or the Express player API.
Run the admin locally, then publish the local catalog into the Next app:

```bash
npm run publish:pack
```

That command:

- Generates or reuses each configured 15-second MP3 snippet.
- Copies only the 15-second files to `apps/web/public/snippets`.
- Writes answer metadata and Spotify IDs to
  `apps/web/src/data/published-game-pack.json`.

Commit the generated snippet files and pack JSON after publishing. Do not commit
`apps/api/uploads/full`, `.env` files, or Spotify secrets.

The Vercel player routes live in Next:

- `GET /api/game/daily`: serves the daily round shell and snippet URLs.
- `GET /api/search?q=...`: searches the published pack plus Spotify when Vercel
  has Spotify credentials configured.
- `POST /api/guess`: validates player guesses against the published answer pack.

The local admin page is available in development only. Production deployments are
read-only player builds.

## Spotify Metadata Search

Create a Spotify developer app and add these environment variables:

```bash
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SPOTIFY_MARKET=IN
```

Spotify is only used for metadata/search. Gameplay audio still comes from your uploaded MP3s.

## Gameplay

- A daily game uses the playable tracks currently uploaded. Set `DAILY_ROUND_COUNT`
  to a positive number only if you want to cap the round count.
- Each song gives 5 guesses/skips.
- The 5th unlock is the 15-second clue, then the answer is revealed.
- Snippet unlock steps are 1s, 2s, 4s, 8s, and 15s.

## Main API

- `GET /api/game/daily`: returns the daily 15-round game shell without leaking answers.
- `GET /api/game/daily/round/:roundNumber/snippet?key=YYYY-MM-DD`: renders or serves the cached 15-second MP3 for a round.
- `GET /api/track/custom/:id`: returns a custom game snippet URL.
- `GET /api/track/custom/:id/snippet`: renders or serves a custom track snippet.
- `GET /api/search?q=...`: returns local plus Spotify autocomplete results.
- `POST /api/guess`: validates a guess against the active round answer.
- `GET /api/admin/catalog/search?q=...`: searches metadata for the admin form.
- `POST /api/admin/tracks`: uploads an MP3 and metadata into the answer pool.

For a hosted admin later, move `tracks.json` to a real database, put full MP3s in
private object storage, add real admin authentication, and add server-side session
state so reveal logic cannot be forced by a client-supplied attempt number.
