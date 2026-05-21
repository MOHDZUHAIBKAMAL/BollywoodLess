const express = require('express');
const { z } = require('zod');
const { attemptsPerRound } = require('../config');
const {
  evaluateGuess,
  findTrackById,
  getDailyKey,
  getGameTrack,
  publicTrack
} = require('../services/trackService');

const router = express.Router();

const guessTrackSchema = z.object({
  id: z.string(),
  song_title: z.string(),
  movie_album: z.string().optional().default('Unknown album'),
  artists: z.array(z.string()).optional().default([]),
  provider: z.string().optional().default('manual'),
  provider_track_id: z.string().optional().default(''),
  artist_ids: z.array(z.string()).optional().default([]),
  isrc: z.string().optional().default(''),
  artwork_url: z.string().optional().default(''),
  provider_url: z.string().optional().default(''),
  release_year: z.string().optional().default('')
});

const guessSchema = z.object({
  dailyKey: z.string().optional(),
  playerSeed: z.string().max(128).optional(),
  roundNumber: z.number().int().min(1).max(500).default(1),
  attempt: z.number().int().min(1).max(5),
  trackId: z.string().optional(),
  guess: guessTrackSchema.optional(),
  skipped: z.boolean().optional()
});

const colorByStatus = {
  correct: '#55B725',
  artist: '#DAC316',
  wrong: '#C62121',
  skipped: '#2A2E31'
};

async function resolveGuess(payload) {
  if (payload.skipped) {
    return null;
  }

  if (payload.guess) {
    return payload.guess;
  }

  if (payload.trackId) {
    return findTrackById(payload.trackId);
  }

  return null;
}

router.post('/guess', async (req, res, next) => {
  try {
    const parsed = guessSchema.safeParse(req.body);

    if (!parsed.success) {
      const error = new Error('Invalid guess payload');
      error.statusCode = 400;
      error.details = parsed.error.flatten();
      throw error;
    }

    const payload = parsed.data;
    const answer = await getGameTrack({
      key: payload.dailyKey || getDailyKey(),
      roundNumber: payload.roundNumber,
      playerSeed: payload.playerSeed || ''
    });

    if (!answer) {
      const error = new Error('Round answer not found');
      error.statusCode = 404;
      throw error;
    }

    const guess = await resolveGuess(payload);

    if (!payload.skipped && !guess) {
      const error = new Error('Guess track not found');
      error.statusCode = 404;
      throw error;
    }

    const status = evaluateGuess(answer, guess);
    const didWin = status === 'correct';
    const didReveal = didWin || payload.attempt >= attemptsPerRound;

    res.json({
      status,
      color: colorByStatus[status],
      roundState: didReveal ? 'revealed' : 'playing',
      guess: guess ? publicTrack(guess) : null,
      correctAnswer: didReveal ? publicTrack(answer) : null
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
