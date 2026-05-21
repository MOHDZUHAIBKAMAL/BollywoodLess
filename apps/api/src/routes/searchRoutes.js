const express = require('express');
const { searchCatalog } = require('../services/catalogSearchService');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const payload = await searchCatalog(req.query.q || '');
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
