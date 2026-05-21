'use client';

import Link from 'next/link';
import {
  ChevronRight,
  HelpCircle,
  Menu,
  Pause,
  Play,
  Search,
  Settings,
  X
} from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  apiUrl,
  DailyGameResponse,
  fetchDailyGame,
  GuessStatus,
  searchTracks,
  submitGuess,
  TrackResult
} from '@/lib/api';

const DEFAULT_STEPS = [1, 2, 4, 8, 15];
const SCORE_BY_ATTEMPT = [5, 4, 3, 2, 1];

type RoundState = 'playing' | 'revealed' | 'complete';

type GuessHistoryItem = {
  label: string;
  detail: string;
  status: GuessStatus;
};

type PersistedGameProgress = {
  gameSignature: string;
  dailyKey: string;
  roundIndex: number;
  currentAttempt: number;
  roundState: RoundState;
  roundHistory: Record<number, GuessHistoryItem[]>;
  roundAnswers: Record<number, TrackResult>;
  roundScores?: Record<number, number>;
  score?: number;
  savedAt: string;
};

const statusClass: Record<GuessStatus, string> = {
  correct: 'border-accent bg-accent text-black',
  artist: 'border-warning bg-warning text-black',
  wrong: 'border-danger bg-danger text-white',
  skipped: 'border-line bg-panel text-zinc-300'
};

function formatSeconds(seconds: number) {
  return seconds < 1 ? `${seconds.toFixed(1)} seconds` : `${seconds} seconds`;
}

function pointsForAttempt(attempt: number) {
  return SCORE_BY_ATTEMPT[attempt - 1] || 0;
}

function deriveRoundScores(roundHistory: Record<number, GuessHistoryItem[]>) {
  return Object.entries(roundHistory).reduce<Record<number, number>>((scores, [round, items]) => {
    const correctIndex = items.findIndex((item) => item.status === 'correct');

    if (correctIndex >= 0) {
      scores[Number(round)] = pointsForAttempt(correctIndex + 1);
    }

    return scores;
  }, {});
}

function getSpotifyTrackId(track: TrackResult) {
  if (track.provider === 'spotify' && track.provider_track_id) {
    return track.provider_track_id;
  }

  const urlMatch = track.provider_url.match(/spotify\.com\/track\/([A-Za-z0-9]+)/);
  return urlMatch?.[1] || '';
}

function getSpotifyEmbedUrl(track: TrackResult) {
  const trackId = getSpotifyTrackId(track);

  if (!trackId) {
    return '';
  }

  return `https://open.spotify.com/embed/track/${encodeURIComponent(trackId)}?utm_source=generator&theme=0`;
}

function progressStorageKey(game: DailyGameResponse) {
  return `bollywoodless:progress:${game.dailyKey}:${game.gameSignature}`;
}

function readPersistedProgress(game: DailyGameResponse) {
  try {
    const raw = window.localStorage.getItem(progressStorageKey(game));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PersistedGameProgress>;
    if (
      parsed.dailyKey !== game.dailyKey ||
      parsed.gameSignature !== game.gameSignature ||
      typeof parsed.roundIndex !== 'number' ||
      typeof parsed.currentAttempt !== 'number'
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function playSoundCue(type: 'correct' | 'wrong' | 'artist' | 'skip' | 'complete') {
  const audioWindow = window as Window &
    typeof globalThis & {
      webkitAudioContext?: typeof AudioContext;
    };
  const AudioContextClass = audioWindow.AudioContext || audioWindow.webkitAudioContext;

  if (!AudioContextClass) {
    return;
  }

  const context = new AudioContextClass();
  const gain = context.createGain();
  gain.connect(context.destination);
  gain.gain.setValueAtTime(0.001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.09, context.currentTime + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.46);

  const cueNotes = {
    correct: [523.25, 659.25, 783.99, 1046.5],
    wrong: [261.63, 220, 196],
    artist: [440, 554.37, 440],
    skip: [330, 330],
    complete: [523.25, 659.25, 783.99, 1046.5, 1318.51]
  };

  cueNotes[type].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    oscillator.type = type === 'wrong' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(frequency, context.currentTime + index * 0.095);
    oscillator.connect(gain);
    oscillator.start(context.currentTime + index * 0.095);
    oscillator.stop(context.currentTime + index * 0.095 + 0.12);
  });

  window.setTimeout(() => {
    void context.close();
  }, 700);
}

function Modal({
  title,
  children,
  onClose
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4">
      <section className="w-full max-w-md rounded-lg border border-line bg-[#1B1E20] p-5 shadow-glow">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full border border-line text-zinc-300 transition hover:border-zinc-400 hover:text-white"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function BollywoodlessGame() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [game, setGame] = useState<DailyGameResponse | null>(null);
  const [roundIndex, setRoundIndex] = useState(0);
  const [currentAttempt, setCurrentAttempt] = useState(1);
  const [roundState, setRoundState] = useState<RoundState>('playing');
  const [roundHistory, setRoundHistory] = useState<Record<number, GuessHistoryItem[]>>({});
  const [roundAnswers, setRoundAnswers] = useState<Record<number, TrackResult>>({});
  const [roundScores, setRoundScores] = useState<Record<number, number>>({});
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TrackResult[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<TrackResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isProgressReady, setIsProgressReady] = useState(false);
  const hasRestoredProgressRef = useRef(false);

  const currentRound = game?.rounds[roundIndex] || null;
  const attemptsPerRound = game?.attemptsPerRound || 5;
  const steps = game?.snippetSeconds?.length ? game.snippetSeconds : DEFAULT_STEPS;
  const maxSnippetSeconds = game?.maxSnippetSeconds || 15;
  const unlockedTime =
    roundState === 'revealed' ? maxSnippetSeconds : steps[currentAttempt - 1] || maxSnippetSeconds;
  const markerPercent = Math.min((unlockedTime / maxSnippetSeconds) * 100, 100);
  const currentRoundNumber = currentRound?.roundNumber || 1;
  const currentHistory = roundHistory[currentRoundNumber] || [];
  const revealedAnswer = roundAnswers[currentRoundNumber] || null;
  const activeSegments =
    roundState === 'revealed' || roundState === 'complete' ? steps.length : currentAttempt;
  const snippetUrl = currentRound ? apiUrl(currentRound.snippetUrl) : undefined;
  const spotifyEmbedUrl = revealedAnswer ? getSpotifyEmbedUrl(revealedAnswer) : '';
  const score = useMemo(
    () => Object.values(roundScores).reduce((total, points) => total + points, 0),
    [roundScores]
  );
  const solvedCount = useMemo(
    () => Object.values(roundScores).filter((points) => points > 0).length,
    [roundScores]
  );
  const maxScore = (game?.rounds.length || 0) * pointsForAttempt(1);

  const segmentWidths = useMemo(
    () =>
      steps.map((step, index) => {
        const previous = index === 0 ? 0 : steps[index - 1];
        return Math.max(step - previous, 0.1);
      }),
    [steps]
  );

  useEffect(() => {
    fetchDailyGame()
      .then((payload) => {
        const saved = readPersistedProgress(payload);
        setGame(payload);

        if (saved && payload.rounds.length) {
          setRoundIndex(Math.min(Math.max(saved.roundIndex || 0, 0), payload.rounds.length - 1));
          setCurrentAttempt(
            Math.min(Math.max(saved.currentAttempt || 1, 1), payload.attemptsPerRound || 5)
          );
          setRoundState(
            saved.roundState === 'revealed' || saved.roundState === 'complete'
              ? saved.roundState
              : 'playing'
          );
          const savedHistory = saved.roundHistory || {};
          setRoundHistory(savedHistory);
          setRoundAnswers(saved.roundAnswers || {});
          setRoundScores(saved.roundScores || deriveRoundScores(savedHistory));
        } else {
          setRoundState(payload.rounds.length ? 'playing' : 'complete');
        }

        hasRestoredProgressRef.current = true;
        setIsProgressReady(true);
      })
      .catch(() => {
        setError('The daily game could not be loaded.');
        setIsProgressReady(true);
      });
  }, []);

  useEffect(() => {
    if (!game || !isProgressReady || !hasRestoredProgressRef.current) {
      return;
    }

    const progress: PersistedGameProgress = {
      gameSignature: game.gameSignature,
      dailyKey: game.dailyKey,
      roundIndex,
      currentAttempt,
      roundState,
      roundHistory,
      roundAnswers,
      roundScores,
      score,
      savedAt: new Date().toISOString()
    };

    window.localStorage.setItem(progressStorageKey(game), JSON.stringify(progress));
  }, [
    currentAttempt,
    game,
    isProgressReady,
    roundAnswers,
    roundHistory,
    roundScores,
    roundIndex,
    roundState,
    score
  ]);

  useEffect(() => {
    if (query.trim().length < 2 || roundState !== 'playing') {
      setResults([]);
      setIsSearching(false);
      return;
    }

    if (selectedTrack && query === selectedTrack.label) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setIsSearching(true);
      searchTracks(query, controller.signal)
        .then(setResults)
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
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, roundState, selectedTrack]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const enforceLimit = () => {
      if (audio.currentTime >= unlockedTime - 0.015) {
        audio.pause();
        audio.currentTime = 0;
        setIsPlaying(false);
      }
    };

    const stopPlayback = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', enforceLimit);
    audio.addEventListener('ended', stopPlayback);
    audio.addEventListener('pause', stopPlayback);

    return () => {
      audio.removeEventListener('timeupdate', enforceLimit);
      audio.removeEventListener('ended', stopPlayback);
      audio.removeEventListener('pause', stopPlayback);
    };
  }, [unlockedTime, snippetUrl]);

  function stopAudio() {
    const audio = audioRef.current;
    if (!audio) return;

    audio.pause();
    audio.currentTime = 0;
    setIsPlaying(false);
  }

  function appendHistory(roundNumber: number, item: GuessHistoryItem) {
    setRoundHistory((history) => ({
      ...history,
      [roundNumber]: [...(history[roundNumber] || []), item].slice(0, attemptsPerRound)
    }));
  }

  function revealRound(answer: TrackResult) {
    setRoundAnswers((answers) => ({
      ...answers,
      [currentRoundNumber]: answer
    }));
    setRoundState('revealed');
  }

  function cue(type: 'correct' | 'wrong' | 'artist' | 'skip' | 'complete') {
    if (soundEnabled) {
      playSoundCue(type);
    }
  }

  async function handlePlay() {
    const audio = audioRef.current;

    if (!audio || !currentRound || roundState === 'complete') {
      return;
    }

    setError('');
    audio.pause();
    audio.currentTime = 0;

    try {
      await audio.play();
      setIsPlaying(true);
    } catch (playbackError) {
      const detail =
        playbackError instanceof Error && playbackError.message
          ? ` ${playbackError.message}`
          : '';
      setError(`Audio playback is not available yet.${detail}`);
      setIsPlaying(false);
    }
  }

  async function handleSkip() {
    if (!game || !currentRound || roundState !== 'playing') {
      return;
    }

    stopAudio();
    setError('');

    try {
      const response = await submitGuess({
        dailyKey: game.dailyKey,
        roundNumber: currentRound.roundNumber,
        attempt: currentAttempt,
        skipped: true
      });

      appendHistory(currentRound.roundNumber, {
        label: 'Skipped',
        detail: formatSeconds(unlockedTime),
        status: 'skipped'
      });

      if (response.roundState === 'revealed' && response.correctAnswer) {
        cue('skip');
        revealRound(response.correctAnswer);
      } else {
        cue('skip');
        setCurrentAttempt((attempt) => Math.min(attempt + 1, attemptsPerRound));
      }
    } catch (skipError) {
      setError(skipError instanceof Error ? skipError.message : 'Skip could not be submitted.');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!game || !currentRound || roundState !== 'playing') {
      return;
    }

    const track = selectedTrack || results[0];

    if (!track) {
      setError('Choose a song from the search results.');
      return;
    }

    stopAudio();
    setError('');

    try {
      const response = await submitGuess({
        dailyKey: game.dailyKey,
        roundNumber: currentRound.roundNumber,
        attempt: currentAttempt,
        guess: track
      });

      const earnedPoints =
        response.status === 'correct' ? pointsForAttempt(currentAttempt) : 0;
      const artistDetail = response.guess?.artists.join(', ') || track.artists.join(', ');

      appendHistory(currentRound.roundNumber, {
        label: response.guess?.label || track.label,
        detail: earnedPoints ? `${artistDetail} - +${earnedPoints} pts` : artistDetail,
        status: response.status
      });

      if (response.status === 'correct') {
        setRoundScores((scores) => ({
          ...scores,
          [currentRound.roundNumber]: earnedPoints
        }));
        cue('correct');
      } else if (response.status === 'artist') {
        cue('artist');
      } else {
        cue('wrong');
      }

      setQuery('');
      setResults([]);
      setSelectedTrack(null);

      if (response.roundState === 'revealed' && response.correctAnswer) {
        if (response.status !== 'correct') {
          cue('wrong');
        }
        revealRound(response.correctAnswer);
      } else {
        setCurrentAttempt((attempt) => Math.min(attempt + 1, attemptsPerRound));
      }
    } catch (guessError) {
      setError(
        guessError instanceof Error ? guessError.message : 'Guess could not be submitted.'
      );
    }
  }

  function chooseResult(track: TrackResult) {
    setSelectedTrack(track);
    setQuery(track.label);
    setResults([]);
  }

  function handleNextRound() {
    stopAudio();
    setQuery('');
    setResults([]);
    setSelectedTrack(null);
    setCurrentAttempt(1);

    if (!game || roundIndex + 1 >= game.rounds.length) {
      setRoundState('complete');
      cue('complete');
      return;
    }

    setRoundIndex((index) => index + 1);
    setRoundState('playing');
  }

  function handleResetProgress() {
    stopAudio();

    if (game) {
      window.localStorage.removeItem(progressStorageKey(game));
      setRoundState(game.rounds.length ? 'playing' : 'complete');
    }

    setRoundIndex(0);
    setCurrentAttempt(1);
    setRoundHistory({});
    setRoundAnswers({});
    setRoundScores({});
    setQuery('');
    setResults([]);
    setSelectedTrack(null);
    setError('');
    setShowSettings(false);
  }

  return (
    <main className="flex h-screen overflow-hidden bg-canvas text-white">
      <div className="flex min-h-0 w-full flex-col">
      <header className="relative flex h-20 shrink-0 items-center justify-center px-5 md:h-24">
        <button
          type="button"
          className="absolute left-5 grid h-10 w-10 place-items-center rounded-full text-zinc-300 transition hover:bg-panel hover:text-white md:left-8"
          aria-label="Open menu"
        >
          <Menu size={24} />
        </button>

        <h1 className="text-center text-4xl font-black tracking-normal text-zinc-100 sm:text-5xl md:text-6xl">
          Bollywoodless
        </h1>

        <div className="absolute right-5 flex items-center justify-end gap-2 sm:gap-3 md:right-8">
          {process.env.NODE_ENV === 'development' ? (
            <Link
              href="/admin"
              className="hidden h-10 items-center rounded-md px-3 text-sm font-semibold text-zinc-300 transition hover:bg-panel hover:text-white sm:inline-flex"
            >
              Admin
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => setShowHelp(true)}
            className="grid h-10 w-10 place-items-center rounded-full border border-line text-zinc-300 transition hover:border-zinc-400 hover:text-white"
            aria-label="How to play"
          >
            <HelpCircle size={24} />
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="grid h-10 w-10 place-items-center rounded-full border border-line text-zinc-300 transition hover:border-zinc-400 hover:text-white"
            aria-label="Settings"
          >
            <Settings size={22} />
          </button>
        </div>
      </header>

      <section className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-5 pb-4">
        <div className="mx-auto w-full max-w-3xl">
          <div className="mb-3 grid grid-cols-3 gap-3 text-xs font-bold text-zinc-300 md:text-sm">
            <div className="rounded-md border border-line bg-panel px-3 py-2">
              Round {game?.rounds.length ? roundIndex + 1 : 0}/{game?.rounds.length || 0}
            </div>
            <div className="rounded-md border border-line bg-panel px-3 py-2 text-center">
              Score {score}/{maxScore}
            </div>
            <div className="rounded-md border border-line bg-panel px-3 py-2 text-right">
              Try {roundState === 'playing' ? currentAttempt : '-'}
            </div>
          </div>

          {game && game.rounds.length === 0 ? (
            <div className="rounded-lg border border-line bg-panel px-5 py-8 text-center">
              <p className="text-lg font-black">No playable uploaded tracks yet.</p>
              <p className="mt-2 text-sm text-zinc-400">
                {process.env.NODE_ENV === 'development'
                  ? 'Upload at least one MP3 in Admin, then publish the pack.'
                  : 'No published songs are available for this deployment.'}
              </p>
              {process.env.NODE_ENV === 'development' ? (
                <Link
                  href="/admin"
                  className="mt-5 inline-flex h-11 items-center rounded-md bg-accent px-5 font-black text-black"
                >
                  Open Admin
                </Link>
              ) : null}
            </div>
          ) : null}

          {!game && !error ? (
            <div className="rounded-lg border border-line bg-panel px-5 py-8 text-center">
              <p className="text-lg font-black">Loading today&apos;s game...</p>
              <p className="mt-2 text-sm text-zinc-400">
                Pulling the uploaded track list and snippet settings.
              </p>
            </div>
          ) : null}

          {!game && error ? (
            <div className="rounded-lg border border-danger/50 bg-danger/10 px-5 py-8 text-center">
              <p className="text-lg font-black text-red-100">Game could not load.</p>
              <p className="mt-2 text-sm text-red-100/80">{error}</p>
            </div>
          ) : null}

          {game && game.rounds.length > 0 && roundState !== 'complete' ? (
            <div className="space-y-2">
              {Array.from({ length: attemptsPerRound }).map((_, index) => {
                const item = currentHistory[index];

                return (
                  <div
                    key={index}
                    className={`flex h-11 items-center justify-between rounded-md border px-4 transition ${
                      item
                        ? statusClass[item.status]
                        : 'border-line bg-transparent text-zinc-500'
                    }`}
                  >
                    {item ? (
                      <>
                        <div className="min-w-0">
                          <p className="truncate font-bold">{item.label}</p>
                          <p className="truncate text-sm opacity-80">{item.detail}</p>
                        </div>
                        <span className="text-xs font-black uppercase tracking-normal">
                          {item.status}
                        </span>
                      </>
                    ) : (
                      <span className="sr-only">Empty row {index + 1}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}

          {roundState === 'revealed' && revealedAnswer ? (
            <div className="mt-3 rounded-md border border-accent/70 bg-panel p-2">
              <div className="px-2">
                <p className="text-xs font-black uppercase tracking-normal text-accent">
                  Answer
                </p>
                <p className="truncate text-sm font-black text-white md:text-base">
                  {revealedAnswer.label}
                </p>
                <p className="truncate text-xs text-zinc-400">
                  {revealedAnswer.artists.join(', ')}
                </p>
              </div>

              {spotifyEmbedUrl ? (
                <div className="relative mt-2 h-[72px] overflow-hidden bg-[#121313]">
                  <iframe
                    title={`Spotify player for ${revealedAnswer.label}`}
                    src={spotifyEmbedUrl}
                    className="absolute -left-1 -right-1 -top-1 block h-20 w-[calc(100%+8px)] border-0 bg-[#121313]"
                    loading="lazy"
                    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {roundState === 'complete' && game?.rounds.length ? (
            <div className="rounded-lg border border-accent/50 bg-[#1B1E20] px-5 py-6 text-center shadow-glow">
              <p className="text-sm font-black uppercase tracking-normal text-accent">
                Game complete
              </p>
              <p className="mt-2 text-5xl font-black text-white">
                {score}/{maxScore}
              </p>
              <p className="mt-2 text-sm font-semibold text-zinc-300">
                {score === maxScore
                  ? 'Perfect run.'
                  : score >= Math.ceil(maxScore * 0.7)
                    ? 'Strong round.'
                    : score >= Math.ceil(maxScore * 0.4)
                      ? 'Solid score.'
                      : 'Warm up round.'}
              </p>
              <div className="mt-5 grid grid-cols-3 gap-2 text-xs font-black uppercase tracking-normal">
                <div className="rounded-md bg-accent px-3 py-2 text-black">Solved {solvedCount}</div>
                <div className="rounded-md bg-danger px-3 py-2 text-white">
                  Missed {game.rounds.length - solvedCount}
                </div>
                <div className="rounded-md bg-panelLight px-3 py-2 text-zinc-100">
                  Max {maxScore}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {game && game.rounds.length > 0 && roundState !== 'complete' ? (
          <div className="mt-auto pt-4">
            <div className="mx-auto w-full max-w-5xl">
              <div className="relative mb-4 pt-6">
                <div
                  className="absolute top-0 -translate-x-1/2 text-center"
                  style={{ left: `${markerPercent}%` }}
                >
                  <p className="whitespace-nowrap text-xs font-black text-zinc-100 sm:text-sm">
                    {formatSeconds(unlockedTime)}
                  </p>
                  <div className="mx-auto mt-1 h-0 w-0 border-x-[8px] border-t-[10px] border-x-transparent border-t-zinc-100" />
                </div>

                <div className="flex h-6 overflow-hidden rounded-md bg-panelLight">
                  {segmentWidths.map((width, index) => (
                    <div
                      key={`${steps[index]}-${index}`}
                      className={`border-r-2 border-canvas last:border-r-0 ${
                        index < activeSegments ? 'bg-accent' : 'bg-panelLight'
                      }`}
                      style={{ flexGrow: width, flexBasis: 0 }}
                    />
                  ))}
                </div>
              </div>

              <div className="mb-4 flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={isPlaying ? stopAudio : handlePlay}
                  disabled={!currentRound}
                  className="grid h-16 w-16 place-items-center rounded-full bg-accent text-white shadow-glow transition hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={isPlaying ? 'Pause snippet' : 'Play snippet'}
                >
                  {isPlaying ? (
                    <Pause size={28} fill="currentColor" />
                  ) : (
                    <Play className="ml-1" size={28} fill="currentColor" />
                  )}
                </button>

                {roundState === 'revealed' ? (
                  <button
                    type="button"
                    onClick={handleNextRound}
                    className="inline-flex h-11 items-center gap-2 rounded-md bg-zinc-100 px-4 font-black text-black transition hover:bg-white"
                  >
                    {roundIndex + 1 >= (game?.rounds.length || 0) ? 'Finish' : 'Next Song'}
                    <ChevronRight size={18} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSkip}
                    className="inline-flex h-11 items-center gap-2 rounded-md border border-line px-4 font-bold text-zinc-200 transition hover:border-zinc-300 hover:bg-panel"
                  >
                    Skip
                    <ChevronRight size={18} />
                  </button>
                )}
              </div>

              {roundState === 'playing' ? (
                <form
                  onSubmit={handleSubmit}
                  className="relative mx-auto flex w-full max-w-3xl gap-3"
                >
                  <div className="relative min-w-0 flex-1">
                    <Search
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400"
                      size={25}
                    />
                    <input
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setSelectedTrack(null);
                      }}
                      placeholder="Search a Bollywood song or artist..."
                      className="h-12 w-full rounded-md border border-transparent bg-panel py-0 pl-14 pr-4 text-base font-semibold text-zinc-100 placeholder:text-zinc-500 transition focus:border-accent"
                    />

                    {query.trim().length >= 2 && !selectedTrack && results.length > 0 ? (
                      <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-20 max-h-56 overflow-y-auto overscroll-contain rounded-lg border border-line bg-[#1B1E20] shadow-glow sm:max-h-64">
                        {results.map((track) => (
                          <button
                            type="button"
                            key={track.id}
                            onClick={() => chooseResult(track)}
                            className="block w-full px-4 py-2.5 text-left transition hover:bg-panel"
                          >
                            <span className="block truncate font-bold text-zinc-100">
                              {track.label}
                            </span>
                            <span className="block truncate text-sm text-zinc-400">
                              {track.artists.join(', ')}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {isSearching ? (
                      <div className="absolute bottom-[calc(100%+8px)] left-0 rounded-md border border-line bg-[#1B1E20] px-3 py-2 text-sm text-zinc-400">
                        Searching
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="submit"
                    className="h-12 min-w-24 rounded-md bg-zinc-100 px-5 font-black text-[#111] transition hover:bg-white"
                  >
                    Guess
                  </button>
                </form>
              ) : null}

              {error ? (
                <p className="mx-auto mt-4 max-w-3xl rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-red-100">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      {snippetUrl ? (
        <audio
          key={snippetUrl}
          ref={audioRef}
          src={snippetUrl}
          preload="metadata"
          onError={() => setError('This round MP3 could not be sliced or played.')}
        />
      ) : null}

      {showHelp ? (
        <Modal title="How to Play" onClose={() => setShowHelp(false)}>
          <div className="space-y-3 text-sm leading-6 text-zinc-300">
            <p>Each game uses the playable MP3 tracks currently in your upload pool.</p>
            <p>
              Each song gives five guesses or skips. The fifth unlock plays the full
              15-second clue, then the answer is revealed.
            </p>
            <p>
              Faster solves score more: 5, 4, 3, 2, then 1 point.
            </p>
            <div className="grid gap-2 pt-1">
              <div className="rounded-md bg-accent px-3 py-2 font-bold text-black">
                Green: correct song
              </div>
              <div className="rounded-md bg-warning px-3 py-2 font-bold text-black">
                Yellow: right artist, wrong song
              </div>
              <div className="rounded-md bg-danger px-3 py-2 font-bold text-white">
                Red: wrong artist and song
              </div>
            </div>
          </div>
        </Modal>
      ) : null}

      {showSettings ? (
        <Modal title="Settings" onClose={() => setShowSettings(false)}>
          <div className="space-y-4 text-sm text-zinc-300">
            <label className="flex items-center justify-between gap-4 rounded-md border border-line bg-panel px-3 py-3">
              <span className="font-semibold text-zinc-100">Reduced motion</span>
              <button
                type="button"
                onClick={() => setReducedMotion((value) => !value)}
                className={`relative h-7 w-12 rounded-full transition ${
                  reducedMotion ? 'bg-accent' : 'bg-panelLight'
                }`}
                aria-pressed={reducedMotion}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${
                    reducedMotion ? 'left-6' : 'left-1'
                  }`}
                />
              </button>
            </label>
            <p className="text-zinc-400">
              Playback is always capped to the unlocked duration on this device.
            </p>
            <label className="flex items-center justify-between gap-4 rounded-md border border-line bg-panel px-3 py-3">
              <span className="font-semibold text-zinc-100">Sound cues</span>
              <button
                type="button"
                onClick={() => setSoundEnabled((value) => !value)}
                className={`relative h-7 w-12 rounded-full transition ${
                  soundEnabled ? 'bg-accent' : 'bg-panelLight'
                }`}
                aria-pressed={soundEnabled}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${
                    soundEnabled ? 'left-6' : 'left-1'
                  }`}
                />
              </button>
            </label>
            <button
              type="button"
              onClick={handleResetProgress}
              disabled={!game}
              className="h-11 w-full rounded-md border border-line bg-panel px-4 font-black text-zinc-100 transition hover:border-zinc-300 hover:bg-panelLight disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reset game
            </button>
          </div>
        </Modal>
      ) : null}
      </div>
    </main>
  );
}
