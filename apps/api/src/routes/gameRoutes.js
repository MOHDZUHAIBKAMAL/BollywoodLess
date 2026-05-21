const express = require('express');
const { getSnippetPath } = require('../services/audioSnippetService');
const {
  getDailyKey,
  getDailyTracks,
  getGameSummary,
  getGameTrack
} = require('../services/trackService');

const router = express.Router();

function queryString(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

router.get('/daily', async (req, res, next) => {
  try {
    const dailyKey = queryString(req.query.date, getDailyKey());
    const rounds = await getDailyTracks(dailyKey);
    res.json(getGameSummary({ dailyKey, rounds }));
  } catch (error) {
    next(error);
  }
});

router.get('/daily/round/:roundNumber/snippet', async (req, res, next) => {
  try {
    const dailyKey = queryString(req.query.key, getDailyKey());
    const roundNumber = Number(req.params.roundNumber);
    const track = await getGameTrack({ key: dailyKey, roundNumber });

    if (!track) {
      const error = new Error('Round not found');
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
