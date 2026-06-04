const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const { randomUUID } = require('crypto');
const { z } = require('zod');
const { uploadRoot } = require('../config');
const { searchCatalog } = require('../services/catalogSearchService');
const {
  addUploadedTrack,
  deleteUploadedTrack,
  findTrackById,
  getUploadedTracks,
  publicTrack,
  updateUploadedTrack
} = require('../services/trackRepository');
const { getSnippetPath } = require('../services/audioSnippetService');

const router = express.Router();
const fullUploadDir = path.join(uploadRoot, 'full');

fs.mkdirSync(fullUploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: fullUploadDir,
    filename(req, file, callback) {
      const extension = path.extname(file.originalname) || '.mp3';
      callback(null, `${randomUUID()}${extension.toLowerCase()}`);
    }
  }),
  limits: {
    fileSize: 40 * 1024 * 1024
  },
  fileFilter(req, file, callback) {
    const isAudio =
      file.mimetype === 'audio/mpeg' ||
      file.mimetype === 'audio/mp3' ||
      file.originalname.toLowerCase().endsWith('.mp3');

    if (!isAudio) {
      const error = new Error('Only MP3 files are supported');
      error.statusCode = 400;
      callback(error, false);
      return;
    }

    callback(null, true);
  }
});

const uploadSchema = z.object({
  song_title: z.string().min(1),
  movie_album: z.string().min(1),
  artists: z.string().min(1),
  snippet_start_time: z.coerce.number().int().min(0).default(0),
  provider: z.string().optional().default('manual'),
  provider_track_id: z.string().optional().default(''),
  provider_url: z.string().optional().default(''),
  artist_ids: z.string().optional().default(''),
  isrc: z.string().optional().default(''),
  artwork_url: z.string().optional().default(''),
  release_year: z.string().optional().default(''),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional().default('medium')
});

const updateSchema = uploadSchema.omit({ provider: true }).extend({
  provider: z.string().optional().default('manual')
});

function parseStringList(value) {
  const trimmed = String(value || '').trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(String).filter(Boolean);
      }
    } catch {
      // Fall back to comma parsing below.
    }
  }

  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

router.get('/tracks', async (req, res, next) => {
  try {
    const tracks = await getUploadedTracks();
    res.json({
      tracks: tracks.map(publicTrack)
    });
  } catch (error) {
    next(error);
  }
});

router.get('/tracks/:id/preview', async (req, res, next) => {
  try {
    const track = await findTrackById(req.params.id);

    if (!track) {
      const error = new Error('Uploaded track not found');
      error.statusCode = 404;
      throw error;
    }

    const startTime = Math.max(0, Number.parseInt(String(req.query.start || '0'), 10) || 0);
    const snippetPath = await getSnippetPath({
      ...track,
      snippet_start_time: startTime
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(snippetPath);
  } catch (error) {
    next(error);
  }
});

router.get('/catalog/search', async (req, res, next) => {
  try {
    const payload = await searchCatalog(req.query.q || '', 12);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.post('/tracks', upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) {
      const error = new Error('MP3 file is required');
      error.statusCode = 400;
      throw error;
    }

    const parsed = uploadSchema.safeParse(req.body);

    if (!parsed.success) {
      const error = new Error('Invalid track metadata');
      error.statusCode = 400;
      error.details = parsed.error.flatten();
      throw error;
    }

    const body = parsed.data;
    const track = await addUploadedTrack({
      song_title: body.song_title,
      movie_album: body.movie_album,
      artists: parseStringList(body.artists),
      snippet_start_time: body.snippet_start_time,
      full_audio_url: req.file.path,
      provider: body.provider,
      provider_track_id: body.provider_track_id,
      provider_url: body.provider_url,
      artist_ids: parseStringList(body.artist_ids),
      isrc: body.isrc,
      artwork_url: body.artwork_url,
      release_year: body.release_year,
      difficulty: body.difficulty,
      original_file_name: req.file.originalname
    });

    res.status(201).json({
      track: publicTrack(track)
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/tracks/:id', async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);

    if (!parsed.success) {
      const error = new Error('Invalid track metadata');
      error.statusCode = 400;
      error.details = parsed.error.flatten();
      throw error;
    }

    const body = parsed.data;
    const track = await updateUploadedTrack(req.params.id, {
      song_title: body.song_title,
      movie_album: body.movie_album,
      artists: parseStringList(body.artists),
      snippet_start_time: body.snippet_start_time,
      provider: body.provider,
      provider_track_id: body.provider_track_id,
      provider_url: body.provider_url,
      artist_ids: parseStringList(body.artist_ids),
      isrc: body.isrc,
      artwork_url: body.artwork_url,
      release_year: body.release_year,
      difficulty: body.difficulty
    });

    if (!track) {
      const error = new Error('Uploaded track not found');
      error.statusCode = 404;
      throw error;
    }

    res.json({
      track: publicTrack(track)
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/tracks/:id', async (req, res, next) => {
  try {
    const track = await deleteUploadedTrack(req.params.id);

    if (!track) {
      const error = new Error('Uploaded track not found');
      error.statusCode = 404;
      throw error;
    }

    res.json({
      deleted: true,
      track: publicTrack(track)
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
