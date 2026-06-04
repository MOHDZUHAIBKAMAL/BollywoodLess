'use client';

import Link from 'next/link';
import { ArrowLeft, Check, Pencil, Play, Search, Trash2, Upload, X } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import {
  adminTrackPreviewUrl,
  deleteAdminTrack,
  fetchAdminTracks,
  searchAdminCatalog,
  TrackResult,
  updateAdminTrack,
  uploadAdminTrack
} from '@/lib/api';

type FormState = {
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
};

const emptyForm: FormState = {
  song_title: '',
  movie_album: '',
  artists: '',
  snippet_start_time: '0',
  provider: 'manual',
  provider_track_id: '',
  provider_url: '',
  artist_ids: [],
  isrc: '',
  artwork_url: '',
  release_year: '',
  difficulty: 'medium'
};

export function AdminTracks() {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingTrackId, setEditingTrackId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TrackResult[]>([]);
  const [tracks, setTracks] = useState<TrackResult[]>([]);
  const [providerConfigured, setProviderConfigured] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    fetchAdminTracks()
      .then((payload) => setTracks(payload.tracks))
      .catch(() => {
        setError('Unable to load uploaded tracks.');
      });
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setIsSearching(true);
      searchAdminCatalog(query, controller.signal)
        .then((payload) => {
          setProviderConfigured(payload.providerConfigured);
          setResults(payload.results);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setResults([]);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsSearching(false);
          }
        });
    }, 200);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  function chooseTrack(track: TrackResult) {
    setForm({
      song_title: track.song_title,
      movie_album: track.movie_album,
      artists: track.artists.join(', '),
      snippet_start_time: form.snippet_start_time,
      provider: track.provider || 'manual',
      provider_track_id: track.provider_track_id || '',
      provider_url: track.provider_url || '',
      artist_ids: track.artist_ids || [],
      isrc: track.isrc || '',
      artwork_url: track.artwork_url || '',
      release_year: track.release_year || '',
      difficulty: form.difficulty
    });
    setQuery(track.label);
    setResults([]);
    setMessage('Song metadata selected.');
  }

  function startEdit(track: TrackResult) {
    setEditingTrackId(track.id);
    setFile(null);
    setQuery(track.label);
    setResults([]);
    setForm({
      song_title: track.song_title,
      movie_album: track.movie_album,
      artists: track.artists.join(', '),
      snippet_start_time: String(track.snippet_start_time || 0),
      provider: track.provider || 'manual',
      provider_track_id: track.provider_track_id || '',
      provider_url: track.provider_url || '',
      artist_ids: track.artist_ids || [],
      isrc: track.isrc || '',
      artwork_url: track.artwork_url || '',
      release_year: track.release_year || '',
      difficulty: track.difficulty || 'medium'
    });
    setMessage('Editing uploaded track.');
    setError('');
  }

  function resetForm() {
    setForm(emptyForm);
    setFile(null);
    setQuery('');
    setResults([]);
    setEditingTrackId('');
    setPreviewUrl('');
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!file && !editingTrackId) {
      setError('Choose an MP3 file first.');
      return;
    }

    if (editingTrackId) {
      setIsUploading(true);

      try {
        const payload = await updateAdminTrack(editingTrackId, form);
        setTracks((current) =>
          current.map((track) => (track.id === editingTrackId ? payload.track : track))
        );
        setPreviewUrl('');
        resetForm();
        setMessage('Track updated.');
      } catch (updateError) {
        setError(updateError instanceof Error ? updateError.message : 'Update failed.');
      } finally {
        setIsUploading(false);
      }

      return;
    }

    const uploadFile = file;

    if (!uploadFile) {
      setError('Choose an MP3 file first.');
      return;
    }

    const formData = new FormData();
    formData.append('audio', uploadFile);
    formData.append('song_title', form.song_title);
    formData.append('movie_album', form.movie_album);
    formData.append('artists', form.artists);
    formData.append('snippet_start_time', form.snippet_start_time || '0');
    formData.append('provider', form.provider);
    formData.append('provider_track_id', form.provider_track_id);
    formData.append('provider_url', form.provider_url);
    formData.append('artist_ids', JSON.stringify(form.artist_ids));
    formData.append('isrc', form.isrc);
    formData.append('artwork_url', form.artwork_url);
    formData.append('release_year', form.release_year);
    formData.append('difficulty', form.difficulty);

    setIsUploading(true);

    try {
      const payload = await uploadAdminTrack(formData);
      setTracks((current) => [payload.track, ...current]);
      resetForm();
      setMessage('Track uploaded and added to the answer pool.');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDelete(track: TrackResult) {
    const confirmed = window.confirm(
      `Remove "${track.label}" from the answer pool? This also deletes its uploaded MP3.`
    );

    if (!confirmed) {
      return;
    }

    setError('');
    setMessage('');

    try {
      await deleteAdminTrack(track.id);
      setTracks((current) => current.filter((item) => item.id !== track.id));

      if (editingTrackId === track.id) {
        resetForm();
      }

      setMessage('Track removed.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Delete failed.');
    }
  }

  function previewCurrentStart() {
    if (!editingTrackId) {
      setError('Save the track first, then edit it to preview start times.');
      return;
    }

    setError('');
    setMessage('Previewing this 15-second slice. Save changes when it sounds right.');
    setPreviewUrl(`${adminTrackPreviewUrl(editingTrackId, form.snippet_start_time)}&t=${Date.now()}`);
  }

  return (
    <main className="min-h-screen bg-canvas px-5 py-6 text-white md:px-10">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <Link
          href="/"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-line px-3 text-sm font-bold text-zinc-200 transition hover:border-zinc-300 hover:bg-panel"
        >
          <ArrowLeft size={17} />
          Game
        </Link>
        <h1 className="text-2xl font-black md:text-4xl">Bollywoodless Admin</h1>
        <div className="w-20" />
      </header>

      <section className="mx-auto mt-8 grid max-w-6xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <form
            onSubmit={handleSubmit}
            className="rounded-lg border border-line bg-[#1B1E20] p-5"
          >
          <div className="mb-5">
            <p className="text-lg font-black">
              {editingTrackId ? 'Edit uploaded track' : 'Upload full MP3'}
            </p>
            <p className="mt-1 text-sm text-zinc-400">
              The backend stores the complete MP3 privately and serves only the configured
              15-second slice to players.
            </p>
          </div>

          <label className="mb-4 block">
            <span className="mb-2 block text-sm font-bold text-zinc-300">Find song metadata</span>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
                size={20}
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Spotify or local catalog..."
                className="h-12 w-full rounded-md border border-line bg-panel pl-10 pr-3 font-semibold text-zinc-100 placeholder:text-zinc-500"
              />
            </div>
          </label>

          {!providerConfigured ? (
            <p className="mb-4 rounded-md border border-warning/60 bg-warning/10 px-3 py-2 text-sm text-yellow-100">
              Spotify credentials are not configured yet. Manual entry still works.
            </p>
          ) : null}

          {isSearching ? (
            <p className="mb-3 text-sm text-zinc-400">Searching catalog...</p>
          ) : null}

          {results.length > 0 ? (
            <div className="mb-5 max-h-72 overflow-auto rounded-lg border border-line">
              {results.map((track) => (
                <button
                  type="button"
                  key={track.id}
                  onClick={() => chooseTrack(track)}
                  className="flex w-full gap-3 border-b border-line px-3 py-3 text-left transition last:border-b-0 hover:bg-panel"
                >
                  {track.artwork_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={track.artwork_url}
                      alt=""
                      className="h-12 w-12 rounded object-cover"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded bg-panelLight" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-black">{track.label}</span>
                    <span className="block truncate text-sm text-zinc-400">
                      {track.artists.join(', ')}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-zinc-300">Song title</span>
              <input
                value={form.song_title}
                onChange={(event) => updateField('song_title', event.target.value)}
                required
                className="h-12 w-full rounded-md border border-line bg-panel px-3 font-semibold"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-bold text-zinc-300">Movie / album</span>
              <input
                value={form.movie_album}
                onChange={(event) => updateField('movie_album', event.target.value)}
                required
                className="h-12 w-full rounded-md border border-line bg-panel px-3 font-semibold"
              />
            </label>

            <label className="block md:col-span-2">
              <span className="mb-2 block text-sm font-bold text-zinc-300">Artists</span>
              <input
                value={form.artists}
                onChange={(event) => updateField('artists', event.target.value)}
                required
                placeholder="Arijit Singh, Shreya Ghoshal"
                className="h-12 w-full rounded-md border border-line bg-panel px-3 font-semibold"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-bold text-zinc-300">
                Snippet start second
              </span>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  value={form.snippet_start_time}
                  onChange={(event) => updateField('snippet_start_time', event.target.value)}
                  className="h-12 min-w-0 flex-1 rounded-md border border-line bg-panel px-3 font-semibold"
                />
                <button
                  type="button"
                  onClick={previewCurrentStart}
                  disabled={!editingTrackId}
                  className="inline-flex h-12 items-center gap-2 rounded-md border border-accent/70 px-4 font-black text-accent transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:border-line disabled:text-zinc-500"
                  title={
                    editingTrackId
                      ? 'Preview this 15-second slice'
                      : 'Upload the track first, then edit to preview'
                  }
                >
                  <Play size={17} />
                  Preview
                </button>
              </div>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-bold text-zinc-300">Difficulty</span>
              <select
                value={form.difficulty}
                onChange={(event) =>
                  updateField('difficulty', event.target.value as FormState['difficulty'])
                }
                className="h-12 w-full rounded-md border border-line bg-panel px-3 font-semibold"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </label>

            {!editingTrackId ? (
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-zinc-300">MP3 file</span>
              <input
                type="file"
                accept="audio/mpeg,audio/mp3,.mp3"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                required
                className="block h-12 w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:font-bold file:text-black"
              />
            </label>
            ) : (
              <p className="rounded-md border border-line bg-panel px-3 py-3 text-sm text-zinc-400">
                MP3 replacement is not needed for metadata edits. Remove and re-upload to replace the audio file.
              </p>
            )}
          </div>

          {previewUrl ? (
            <div className="mt-5 rounded-md border border-line bg-panel p-3">
              <p className="mb-2 text-sm font-bold text-zinc-300">
                Preview from {Number(form.snippet_start_time) || 0}s
              </p>
              <audio key={previewUrl} src={previewUrl} controls autoPlay className="w-full" />
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={isUploading}
              className="inline-flex h-12 items-center gap-2 rounded-md bg-accent px-5 font-black text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isUploading ? <Upload size={18} /> : <Check size={18} />}
              {isUploading
                ? editingTrackId
                  ? 'Saving'
                  : 'Uploading'
                : editingTrackId
                  ? 'Save Changes'
                  : 'Save Track'}
            </button>
            {editingTrackId ? (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex h-12 items-center gap-2 rounded-md border border-line px-5 font-bold text-zinc-200 transition hover:border-zinc-300 hover:bg-panel"
              >
                <X size={18} />
                Cancel
              </button>
            ) : null}
          </div>

          {message ? (
            <p className="mt-4 rounded-md border border-accent/50 bg-accent/10 px-3 py-2 text-sm text-green-100">
              {message}
            </p>
          ) : null}

          {error ? (
            <p className="mt-4 rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-red-100">
              {error}
            </p>
          ) : null}
          </form>

          <section className="rounded-lg border border-line bg-[#1B1E20] p-5">
          <div className="mb-5 flex items-end justify-between gap-3">
            <div>
              <p className="text-lg font-black">Uploaded answer pool</p>
              <p className="mt-1 text-sm text-zinc-400">{tracks.length} tracks ready</p>
            </div>
          </div>

          <div className="space-y-3">
            {tracks.length === 0 ? (
              <p className="rounded-md border border-line bg-panel px-3 py-4 text-sm text-zinc-400">
                No uploaded tracks yet.
              </p>
            ) : null}

            {tracks.map((track, index) => (
              <div
                key={track.id}
                className="flex items-center gap-3 rounded-md border border-line bg-panel px-3 py-3"
              >
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded bg-panelLight text-sm font-black">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-black">{track.label}</p>
                  <p className="truncate text-sm text-zinc-400">
                    {track.artists.join(', ')} - {track.difficulty}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => startEdit(track)}
                    className="grid h-9 w-9 place-items-center rounded-md border border-line text-zinc-200 transition hover:border-zinc-300 hover:bg-panelLight"
                    aria-label={`Edit ${track.label}`}
                    title="Edit"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(track)}
                    className="grid h-9 w-9 place-items-center rounded-md border border-danger/60 text-red-200 transition hover:bg-danger/20"
                    aria-label={`Remove ${track.label}`}
                    title="Remove"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          </section>
      </section>
    </main>
  );
}
