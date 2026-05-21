const express = require('express');
const { snippetDurationSeconds } = require('../config');
const {
  findTrackById,
  getDailyKey,
  getDailyTrack,
  snippetSteps
} = require('../services/trackService');
const { getSnippetPath } = require('../services/audioSnippetService');

const router = express.Router();

function queryString(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

router.get('/daily', async (req, res, next) => {
  try {
    const dailyKey = queryString(req.query.date, getDailyKey());

    res.json({
      dailyKey,
      attempts: snippetSteps.length,
      maxSnippetSeconds: snippetDurationSeconds,
      snippetSeconds: snippetSteps,
      snippetUrl: `/api/track/daily/snippet?key=${encodeURIComponent(dailyKey)}`
    });
  } catch (error) {
    next(error);
  }
});

router.get('/daily/snippet', async (req, res, next) => {
  try {
    const track = await getDailyTrack(queryString(req.query.key, getDailyKey()));

    if (!track) {
      const error = new Error('No playable tracks are available');
      error.statusCode = 404;
      throw error;
    }

    const snippetPath = await getSnippetPath(track);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.sendFile(snippetPath);
  } catch (error) {
    next(error);
  }
});

router.get('/custom/:id', async (req, res, next) => {
  try {
    const track = await findTrackById(req.params.id);

    if (!track) {
      const error = new Error('Track not found');
      error.statusCode = 404;
      throw error;
    }

    res.json({
      customKey: track.id,
      targetId: track.id,
      attempts: snippetSteps.length,
      maxSnippetSeconds: snippetDurationSeconds,
      snippetSeconds: snippetSteps,
      snippetUrl: `/api/track/custom/${track.id}/snippet`
    });
  } catch (error) {
    next(error);
  }
});

router.get('/custom/:id/snippet', async (req, res, next) => {
  try {
    const track = await findTrackById(req.params.id);

    if (!track) {
      const error = new Error('Track not found');
      error.statusCode = 404;
      throw error;
    }

    const snippetPath = await getSnippetPath(track);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.sendFile(snippetPath);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
