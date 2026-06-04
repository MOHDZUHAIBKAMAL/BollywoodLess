require('dotenv').config();

const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const { isAllowedCorsOrigin, port } = require('./config');
const adminRoutes = require('./routes/adminRoutes');
const gameRoutes = require('./routes/gameRoutes');
const guessRoutes = require('./routes/guessRoutes');
const searchRoutes = require('./routes/searchRoutes');
const trackRoutes = require('./routes/trackRoutes');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: 'cross-origin'
    }
  })
);
app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedCorsOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${origin}`));
    }
  })
);
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/admin', adminRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/track', trackRoutes);
app.use('/api/search', searchRoutes);
app.use('/api', guessRoutes);

app.use(notFound);
app.use(errorHandler);

app.listen(port, () => {
  console.log(`Bollywoodless API listening on http://localhost:${port}`);
});
