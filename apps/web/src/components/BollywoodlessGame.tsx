'use client';

import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Menu,
  Pause,
  Play,
  Search,
  Settings,
  Trophy,
  X
} from 'lucide-react';
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  apiUrl,
  DailyGameResponse,
  fetchLeaderboard,
  fetchDailyGame,
  GuessStatus,
  LeaderboardEntry,
  LeaderboardScope,
  searchTracks,
  submitLeaderboardScore,
  submitGuess,
  TrackResult
} from '@/lib/api';

const DEFAULT_STEPS = [1, 2, 4, 8, 15];
const SCORE_BY_ATTEMPT = [5, 4, 3, 2, 1];
const PLAYER_SEED_STORAGE_KEY = 'bollywoodless:player-seed';
const PLAYER_NAME_STORAGE_KEY = 'bollywoodless:leaderboard-name';
const LEADERBOARD_PERMISSION_STORAGE_KEY = 'bollywoodless:leaderboard-permission';
const LEADERBOARD_SUBMITTED_PREFIX = 'bollywoodless:leaderboard-submitted:';
const PROGRESS_STORAGE_PREFIX = 'bollywoodless:progress:';
const STORAGE_VERSION_KEY = 'bollywoodless:storage-version';

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
  viewedRoundIndex?: number;
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
  return `${PROGRESS_STORAGE_PREFIX}${game.storageVersion}:${game.dailyKey}:${game.gameSignature}`;
}

function leaderboardSubmittedKey(game: DailyGameResponse) {
  return `${LEADERBOARD_SUBMITTED_PREFIX}${game.storageVersion}:${game.dailyKey}:${game.gameSignature}`;
}

function createPlayerSeed() {
  if (window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getOrCreatePlayerSeed() {
  try {
    const savedSeed = window.localStorage.getItem(PLAYER_SEED_STORAGE_KEY);

    if (savedSeed) {
      return savedSeed;
    }

    const seed = createPlayerSeed();
    window.localStorage.setItem(PLAYER_SEED_STORAGE_KEY, seed);
    return seed;
  } catch {
    return createPlayerSeed();
  }
}

function refreshProgressStorage(storageVersion: string) {
  try {
    if (window.localStorage.getItem(STORAGE_VERSION_KEY) === storageVersion) {
      return;
    }

    const staleProgressKeys: string[] = [];

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);

      if (key?.startsWith(PROGRESS_STORAGE_PREFIX)) {
        staleProgressKeys.push(key);
      }
    }

    staleProgressKeys.forEach((key) => window.localStorage.removeItem(key));
    window.localStorage.setItem(STORAGE_VERSION_KEY, storageVersion);
  } catch {
    // Browsers can block storage. Gameplay still works for the current tab.
  }
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

function readStorageValue(key: string) {
  try {
    return window.localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeStorageValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be disabled. Keep the current tab behavior working.
  }
}

function clampIndex(value: unknown, min: number, max: number) {
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : min;
  return Math.min(Math.max(numericValue, min), max);
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
  const playerSeedRef = useRef('');
  const [game, setGame] = useState<DailyGameResponse | null>(null);
  const [roundIndex, setRoundIndex] = useState(0);
  const [viewedRoundIndex, setViewedRoundIndex] = useState(0);
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
  const [playbackTime, setPlaybackTime] = useState(0);
  const [error, setError] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isProgressReady, setIsProgressReady] = useState(false);
  const [leaderboardScope, setLeaderboardScope] = useState<LeaderboardScope>('daily');
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const [leaderboardConfigured, setLeaderboardConfigured] = useState(true);
  const [leaderboardError, setLeaderboardError] = useState('');
  const [leaderboardMessage, setLeaderboardMessage] = useState('');
  const [latestLeaderboardEntryId, setLatestLeaderboardEntryId] = useState('');
  const [showLeaderboardPrompt, setShowLeaderboardPrompt] = useState(false);
  const [playerNameInput, setPlayerNameInput] = useState('');
  const [isSubmittingLeaderboard, setIsSubmittingLeaderboard] = useState(false);
  const hasRestoredProgressRef = useRef(false);

  const activeRound = game?.rounds[roundIndex] || null;
  const isViewingResults =
    Boolean(game?.rounds.length) && roundState === 'complete' && viewedRoundIndex >= (game?.rounds.length || 0);
  const viewedRound =
    game && viewedRoundIndex >= 0 && viewedRoundIndex < game.rounds.length
      ? game.rounds[viewedRoundIndex]
      : null;
  const maxViewableRoundIndex =
    game && game.rounds.length
      ? roundState === 'complete'
        ? game.rounds.length
        : roundIndex
      : 0;
  const isViewingActiveRound = viewedRoundIndex === roundIndex && roundState !== 'complete';
  const attemptsPerRound = game?.attemptsPerRound || 5;
  const steps = game?.snippetSeconds?.length ? game.snippetSeconds : DEFAULT_STEPS;
  const maxSnippetSeconds = game?.maxSnippetSeconds || 15;
  const viewedRoundNumber = viewedRound?.roundNumber || 1;
  const viewedAnswer = roundAnswers[viewedRoundNumber] || null;
  const viewedRoundState: RoundState =
    isViewingResults
      ? 'complete'
      : viewedAnswer || (roundState === 'complete' && viewedRoundIndex < (game?.rounds.length || 0))
      ? 'revealed'
      : isViewingActiveRound
        ? roundState
        : 'playing';
  const unlockedTime =
    viewedRoundState === 'revealed' || !isViewingActiveRound
      ? maxSnippetSeconds
      : steps[currentAttempt - 1] || maxSnippetSeconds;
  const markerPercent = Math.min((unlockedTime / maxSnippetSeconds) * 100, 100);
  const playbackPercent = Math.min((playbackTime / maxSnippetSeconds) * 100, markerPercent);
  const progressFillPercent = isPlaying ? playbackPercent : markerPercent;
  const activeRoundNumber = activeRound?.roundNumber || 1;
  const currentHistory = roundHistory[viewedRoundNumber] || [];
  const revealedAnswer = viewedAnswer;
  const snippetUrl = viewedRound ? apiUrl(viewedRound.snippetUrl) : undefined;
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

  const submitScoreToLeaderboard = useCallback(
    async (playerName: string) => {
      if (!game || isSubmittingLeaderboard) {
        return;
      }

      const trimmedName = playerName.replace(/\s+/g, ' ').trim();

      if (!trimmedName) {
        setLeaderboardError('Enter a name for the leaderboard.');
        return;
      }

      setIsSubmittingLeaderboard(true);
      setLeaderboardError('');

      try {
        const submitted = await submitLeaderboardScore({
          playerName: trimmedName,
          playerSeed: playerSeedRef.current,
          dailyKey: game.dailyKey,
          gameSignature: game.gameSignature,
          score,
          maxScore,
          solvedCount,
          roundCount: game.rounds.length
        });
        writeStorageValue(PLAYER_NAME_STORAGE_KEY, trimmedName);
        writeStorageValue(LEADERBOARD_PERMISSION_STORAGE_KEY, 'accepted');
        writeStorageValue(leaderboardSubmittedKey(game), '1');
        setPlayerNameInput(trimmedName);
        setLatestLeaderboardEntryId(submitted.entry.id);
        setShowLeaderboardPrompt(false);
        setShowLeaderboard(true);
        setLeaderboardMessage(`Score saved as ${trimmedName}.`);
        const payload = await fetchLeaderboard(leaderboardScope, game.dailyKey);
        setLeaderboardEntries(payload.entries);
        setLeaderboardConfigured(payload.configured);
      } catch (submitError) {
        setLeaderboardError(
          submitError instanceof Error
            ? submitError.message
            : 'Leaderboard score could not be saved.'
        );
      } finally {
        setIsSubmittingLeaderboard(false);
      }
    },
    [game, isSubmittingLeaderboard, leaderboardScope, maxScore, score, solvedCount]
  );

  const segmentWidths = useMemo(
    () =>
      steps.map((step, index) => {
        const previous = index === 0 ? 0 : steps[index - 1];
        return Math.max(step - previous, 0.1);
      }),
    [steps]
  );

  useEffect(() => {
    const playerSeed = getOrCreatePlayerSeed();
    playerSeedRef.current = playerSeed;
    setPlayerNameInput(readStorageValue(PLAYER_NAME_STORAGE_KEY));

    fetchDailyGame(playerSeed)
      .then((payload) => {
        refreshProgressStorage(payload.storageVersion);
        const saved = readPersistedProgress(payload);
        setGame(payload);

        if (saved && payload.rounds.length) {
          const restoredRoundIndex = clampIndex(saved.roundIndex, 0, payload.rounds.length - 1);
          const restoredViewedRoundIndex =
            saved.roundState === 'complete'
              ? clampIndex(saved.viewedRoundIndex, 0, payload.rounds.length)
              : clampIndex(saved.viewedRoundIndex ?? restoredRoundIndex, 0, restoredRoundIndex);
          setRoundIndex(restoredRoundIndex);
          setViewedRoundIndex(restoredViewedRoundIndex);
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
    if (!game || !showLeaderboard) {
      return;
    }

    fetchLeaderboard(leaderboardScope, game.dailyKey)
      .then((payload) => {
        setLeaderboardEntries(payload.entries);
        setLeaderboardConfigured(payload.configured);
        setLeaderboardError('');
      })
      .catch((leaderboardLoadError) => {
        setLeaderboardEntries([]);
        setLeaderboardError(
          leaderboardLoadError instanceof Error
            ? leaderboardLoadError.message
            : 'Leaderboard could not be loaded.'
        );
      });
  }, [game, leaderboardScope, showLeaderboard]);

  useEffect(() => {
    if (!game || !isViewingResults || !isProgressReady) {
      return;
    }

    const permission = readStorageValue(LEADERBOARD_PERMISSION_STORAGE_KEY);
    const savedName = readStorageValue(PLAYER_NAME_STORAGE_KEY);
    const submittedKey = leaderboardSubmittedKey(game);

    if (readStorageValue(submittedKey)) {
      return;
    }

    if (permission === 'accepted' && savedName) {
      void submitScoreToLeaderboard(savedName);
      return;
    }

    if (!permission) {
      setPlayerNameInput(savedName);
      setShowLeaderboardPrompt(true);
    }
  }, [game, isProgressReady, isViewingResults, submitScoreToLeaderboard]);

  useEffect(() => {
    if (!game || !isProgressReady || !hasRestoredProgressRef.current) {
      return;
    }

    const progress: PersistedGameProgress = {
      gameSignature: game.gameSignature,
      dailyKey: game.dailyKey,
      roundIndex,
      viewedRoundIndex,
      currentAttempt,
      roundState,
      roundHistory,
      roundAnswers,
      roundScores,
      score,
      savedAt: new Date().toISOString()
    };

    try {
      window.localStorage.setItem(progressStorageKey(game), JSON.stringify(progress));
    } catch {
      // If storage is unavailable, keep the in-memory game running for this tab.
    }
  }, [
    currentAttempt,
    game,
    isProgressReady,
    roundAnswers,
    roundHistory,
    roundScores,
    roundIndex,
    roundState,
    score,
    viewedRoundIndex
  ]);

  useEffect(() => {
    if (query.trim().length < 2 || roundState !== 'playing' || !isViewingActiveRound) {
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
  }, [isViewingActiveRound, query, roundState, selectedTrack]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    let progressFrame = 0;

    const syncPlayback = () => {
      setPlaybackTime(Math.min(audio.currentTime, unlockedTime));

      if (audio.currentTime >= unlockedTime - 0.015) {
        audio.pause();
        audio.currentTime = 0;
        setIsPlaying(false);
        setPlaybackTime(0);
        return false;
      }

      return true;
    };

    const animatePlayback = () => {
      if (!syncPlayback() || audio.paused || audio.ended) {
        return;
      }

      progressFrame = window.requestAnimationFrame(animatePlayback);
    };

    const startPlaybackAnimation = () => {
      window.cancelAnimationFrame(progressFrame);
      progressFrame = window.requestAnimationFrame(animatePlayback);
    };

    const stopPlayback = () => {
      window.cancelAnimationFrame(progressFrame);
      setIsPlaying(false);
      setPlaybackTime(audio.currentTime || 0);
    };

    audio.addEventListener('play', startPlaybackAnimation);
    audio.addEventListener('timeupdate', syncPlayback);
    audio.addEventListener('ended', stopPlayback);
    audio.addEventListener('pause', stopPlayback);

    return () => {
      window.cancelAnimationFrame(progressFrame);
      audio.removeEventListener('play', startPlaybackAnimation);
      audio.removeEventListener('timeupdate', syncPlayback);
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
    setPlaybackTime(0);
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
      [activeRoundNumber]: answer
    }));
    setRoundState('revealed');
    setViewedRoundIndex(roundIndex);
  }

  function cue(type: 'correct' | 'wrong' | 'artist' | 'skip' | 'complete') {
    if (soundEnabled) {
      playSoundCue(type);
    }
  }

  async function handlePlay() {
    const audio = audioRef.current;

    if (!audio || !viewedRound || viewedRoundState === 'complete') {
      return;
    }

    setError('');
    audio.pause();
    audio.currentTime = 0;
    setPlaybackTime(0);

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
    if (!game || !activeRound || roundState !== 'playing' || !isViewingActiveRound) {
      return;
    }

    stopAudio();
    setError('');

    try {
      const response = await submitGuess({
        dailyKey: game.dailyKey,
        playerSeed: playerSeedRef.current,
        roundNumber: activeRound.roundNumber,
        attempt: currentAttempt,
        skipped: true
      });

      appendHistory(activeRound.roundNumber, {
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

    if (!game || !activeRound || roundState !== 'playing' || !isViewingActiveRound) {
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
        playerSeed: playerSeedRef.current,
        roundNumber: activeRound.roundNumber,
        attempt: currentAttempt,
        guess: track
      });

      const earnedPoints =
        response.status === 'correct' ? pointsForAttempt(currentAttempt) : 0;
      const artistDetail = response.guess?.artists.join(', ') || track.artists.join(', ');

      appendHistory(activeRound.roundNumber, {
        label: response.guess?.label || track.label,
        detail: earnedPoints ? `${artistDetail} - +${earnedPoints} pts` : artistDetail,
        status: response.status
      });

      if (response.status === 'correct') {
        setRoundScores((scores) => ({
          ...scores,
          [activeRound.roundNumber]: earnedPoints
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
      setViewedRoundIndex(game?.rounds.length || roundIndex);
      cue('complete');
      return;
    }

    setRoundIndex((index) => {
      const nextIndex = index + 1;
      setViewedRoundIndex(nextIndex);
      return nextIndex;
    });
    setRoundState('playing');
  }

  function viewRound(delta: number) {
    stopAudio();
    setError('');
    setQuery('');
    setResults([]);
    setSelectedTrack(null);
    setViewedRoundIndex((index) =>
      Math.min(Math.max(index + delta, 0), maxViewableRoundIndex)
    );
  }

  function handleResetProgress() {
    stopAudio();

    if (game) {
      window.localStorage.removeItem(progressStorageKey(game));
      setRoundState(game.rounds.length ? 'playing' : 'complete');
    }

    setRoundIndex(0);
    setViewedRoundIndex(0);
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

  function declineLeaderboard() {
    writeStorageValue(LEADERBOARD_PERMISSION_STORAGE_KEY, 'declined');
    setShowLeaderboardPrompt(false);
    setLeaderboardMessage('');
  }

  function handleLeaderboardSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitScoreToLeaderboard(playerNameInput);
  }

  function openLeaderboard() {
    setShowMenu(false);
    setShowLeaderboard(true);
  }

  function openHelp() {
    setShowMenu(false);
    setShowHelp(true);
  }

  function openSettings() {
    setShowMenu(false);
    setShowSettings(true);
  }

  return (
    <main className="flex h-screen overflow-hidden bg-canvas text-white">
      <div className="flex min-h-0 w-full flex-col">
      <header className="relative flex h-20 shrink-0 items-center justify-center px-5 md:h-24">
        <button
          type="button"
          onClick={() => setShowMenu(true)}
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
            <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-panel px-2 py-1.5">
              <button
                type="button"
                onClick={() => viewRound(-1)}
                disabled={!game?.rounds.length || viewedRoundIndex <= 0}
                className="grid h-7 w-7 place-items-center rounded-md text-zinc-300 transition hover:bg-panelLight hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="View previous round"
              >
                <ChevronLeft size={17} />
              </button>
              <span className="min-w-0 text-center">
                {isViewingResults ? (
                  'Results'
                ) : (
                  <>
                    Round {game?.rounds.length ? viewedRoundIndex + 1 : 0}/
                    {game?.rounds.length || 0}
                  </>
                )}
                {viewedRoundIndex !== roundIndex && viewedRoundState !== 'complete' ? (
                  <span className="ml-1 text-[10px] uppercase text-zinc-500">Review</span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => viewRound(1)}
                disabled={!game?.rounds.length || viewedRoundIndex >= maxViewableRoundIndex}
                className="grid h-7 w-7 place-items-center rounded-md text-zinc-300 transition hover:bg-panelLight hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="View next round"
              >
                <ChevronRight size={17} />
              </button>
            </div>
            <div className="rounded-md border border-line bg-panel px-3 py-2 text-center">
              Score {score}/{maxScore}
            </div>
            <div className="rounded-md border border-line bg-panel px-3 py-2 text-right">
              Try {isViewingActiveRound && roundState === 'playing' ? currentAttempt : '-'}
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

          {game && game.rounds.length > 0 && viewedRoundState !== 'complete' ? (
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

          {viewedRoundState === 'revealed' && revealedAnswer ? (
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

          {isViewingResults && game?.rounds.length ? (
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
              <button
                type="button"
                onClick={openLeaderboard}
                className="mt-5 inline-flex h-11 items-center gap-2 rounded-md border border-accent/70 px-4 font-black text-accent transition hover:bg-accent/10"
              >
                <Trophy size={18} />
                View leaderboard
              </button>
            </div>
          ) : null}
        </div>

        {game && game.rounds.length > 0 && viewedRoundState !== 'complete' ? (
          <div className="mt-auto pt-4">
            <div className="mx-auto w-full max-w-5xl">
              <div className="relative mb-4 pt-6">
                <div
                  className="absolute top-0 z-10 -translate-x-1/2 text-center"
                  style={{ left: `${markerPercent}%` }}
                >
                  <p className="whitespace-nowrap text-xs font-black text-zinc-100 sm:text-sm">
                    {formatSeconds(unlockedTime)}
                  </p>
                  <div className="mx-auto mt-1 h-0 w-0 border-x-[8px] border-t-[10px] border-x-transparent border-t-zinc-100" />
                </div>

                <div className="relative h-6 overflow-hidden rounded-md bg-panelLight">
                  <div
                    className="absolute inset-y-0 left-0 bg-accent"
                    style={{ width: `${progressFillPercent}%`, willChange: 'width' }}
                  />
                  <div className="absolute inset-0 flex">
                  {segmentWidths.map((width, index) => (
                    <div
                      key={`${steps[index]}-${index}`}
                      className="border-r-2 border-canvas last:border-r-0"
                      style={{ flexGrow: width, flexBasis: 0 }}
                    />
                  ))}
                  </div>
                </div>
              </div>

              <div className="mb-4 flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={isPlaying ? stopAudio : handlePlay}
                  disabled={!viewedRound}
                  className="grid h-16 w-16 place-items-center rounded-full bg-accent text-white shadow-glow transition hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={isPlaying ? 'Pause snippet' : 'Play snippet'}
                >
                  {isPlaying ? (
                    <Pause size={28} fill="currentColor" />
                  ) : (
                    <Play className="ml-1" size={28} fill="currentColor" />
                  )}
                </button>

                {viewedRoundState === 'revealed' ? (
                  <button
                    type="button"
                    onClick={
                      roundState === 'complete'
                        ? () => viewRound(maxViewableRoundIndex - viewedRoundIndex)
                        : isViewingActiveRound
                        ? handleNextRound
                        : () => viewRound(viewedRoundIndex < maxViewableRoundIndex ? 1 : 0)
                    }
                    className="inline-flex h-11 items-center gap-2 rounded-md bg-zinc-100 px-4 font-black text-black transition hover:bg-white"
                  >
                    {roundState === 'complete'
                      ? 'Results'
                      : isViewingActiveRound
                      ? roundIndex + 1 >= (game?.rounds.length || 0)
                        ? 'Finish'
                        : 'Next Song'
                      : viewedRoundIndex < maxViewableRoundIndex
                        ? 'Next Round'
                        : 'Current Round'}
                    <ChevronRight size={18} />
                  </button>
                ) : isViewingActiveRound ? (
                  <button
                    type="button"
                    onClick={handleSkip}
                    className="inline-flex h-11 items-center gap-2 rounded-md border border-line px-4 font-bold text-zinc-200 transition hover:border-zinc-300 hover:bg-panel"
                  >
                    Skip
                    <ChevronRight size={18} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => viewRound(maxViewableRoundIndex - viewedRoundIndex)}
                    className="inline-flex h-11 items-center gap-2 rounded-md border border-line px-4 font-bold text-zinc-200 transition hover:border-zinc-300 hover:bg-panel"
                  >
                    Current Round
                    <ChevronRight size={18} />
                  </button>
                )}
              </div>

              {roundState === 'playing' && isViewingActiveRound ? (
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

      {showMenu ? (
        <Modal title="Menu" onClose={() => setShowMenu(false)}>
          <div className="grid gap-3">
            <button
              type="button"
              onClick={openLeaderboard}
              className="flex h-12 items-center justify-between rounded-md border border-line bg-panel px-4 font-black text-zinc-100 transition hover:border-accent hover:bg-accent/10 hover:text-accent"
            >
              <span className="inline-flex items-center gap-3">
                <Trophy size={18} />
                Leaderboard
              </span>
              <ChevronRight size={18} />
            </button>
            <button
              type="button"
              onClick={openHelp}
              className="flex h-12 items-center justify-between rounded-md border border-line bg-panel px-4 font-black text-zinc-100 transition hover:border-zinc-300 hover:bg-panelLight"
            >
              <span className="inline-flex items-center gap-3">
                <HelpCircle size={18} />
                How to play
              </span>
              <ChevronRight size={18} />
            </button>
            <button
              type="button"
              onClick={openSettings}
              className="flex h-12 items-center justify-between rounded-md border border-line bg-panel px-4 font-black text-zinc-100 transition hover:border-zinc-300 hover:bg-panelLight"
            >
              <span className="inline-flex items-center gap-3">
                <Settings size={18} />
                Settings
              </span>
              <ChevronRight size={18} />
            </button>
          </div>
        </Modal>
      ) : null}

      {showLeaderboard ? (
        <Modal title="Leaderboard" onClose={() => setShowLeaderboard(false)}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 rounded-md border border-line bg-panel p-1 text-sm font-black">
              <button
                type="button"
                onClick={() => setLeaderboardScope('daily')}
                className={`rounded px-3 py-2 ${
                  leaderboardScope === 'daily'
                    ? 'bg-accent text-black'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setLeaderboardScope('allTime')}
                className={`rounded px-3 py-2 ${
                  leaderboardScope === 'allTime'
                    ? 'bg-accent text-black'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                All time
              </button>
            </div>

            {!leaderboardConfigured ? (
              <p className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-yellow-100">
                Shared leaderboard storage is not configured yet. Only the house score is shown.
              </p>
            ) : null}

            {leaderboardMessage ? (
              <p className="rounded-md border border-accent/50 bg-accent/10 px-3 py-2 text-xs text-green-100">
                {leaderboardMessage}
              </p>
            ) : null}

            {leaderboardError ? (
              <p className="rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-xs text-red-100">
                {leaderboardError}
              </p>
            ) : null}

            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {leaderboardEntries.length === 0 ? (
                <p className="rounded-md border border-line bg-panel px-3 py-4 text-sm text-zinc-400">
                  Loading leaderboard...
                </p>
              ) : null}
              {leaderboardEntries.map((entry, index) => {
                const isLatest = entry.id === latestLeaderboardEntryId;

                return (
                  <div
                    key={entry.id}
                    className={`grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-md border px-3 py-2 transition ${
                      isLatest ? 'animate-[leaderboard-pop_900ms_ease-out]' : ''
                    } ${
                      entry.isSeeded
                        ? 'border-accent/60 bg-accent/10'
                        : isLatest
                          ? 'border-accent bg-accent/20'
                          : 'border-line bg-panel'
                    }`}
                  >
                    <span className="text-sm font-black text-zinc-400">#{index + 1}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-black text-white">
                        {entry.playerName}
                        {entry.isSeeded ? (
                          <span className="ml-2 text-xs text-accent">house</span>
                        ) : null}
                        {isLatest ? (
                          <span className="ml-2 text-xs text-accent">you</span>
                        ) : null}
                      </span>
                      <span className="block truncate text-xs text-zinc-400">
                        Solved {entry.solvedCount}/{entry.roundCount}
                      </span>
                    </span>
                    <span className="font-black text-accent">
                      {entry.score}/{entry.maxScore}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </Modal>
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

      {showLeaderboardPrompt ? (
        <Modal title="Join leaderboard" onClose={declineLeaderboard}>
          <form onSubmit={handleLeaderboardSubmit} className="space-y-4">
            <p className="text-sm leading-6 text-zinc-300">
              Save your name once and use it for future Bollywoodless leaderboards on this device.
            </p>
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-zinc-300">Name</span>
              <input
                value={playerNameInput}
                onChange={(event) => setPlayerNameInput(event.target.value)}
                maxLength={28}
                placeholder="Enter your leaderboard name"
                className="h-11 w-full rounded-md border border-line bg-panel px-3 font-semibold text-white placeholder:text-zinc-500"
              />
            </label>
            {leaderboardError ? (
              <p className="rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-red-100">
                {leaderboardError}
              </p>
            ) : null}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={isSubmittingLeaderboard}
                className="h-11 flex-1 rounded-md bg-accent px-4 font-black text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmittingLeaderboard ? 'Saving' : 'Save score'}
              </button>
              <button
                type="button"
                onClick={declineLeaderboard}
                className="h-11 rounded-md border border-line px-4 font-bold text-zinc-200 transition hover:border-zinc-300 hover:bg-panel"
              >
                Not now
              </button>
            </div>
          </form>
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
