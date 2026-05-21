const { timingSafeEqual } = require('crypto');
const { adminPassword, adminUsername } = require('../config');

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function adminAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme !== 'Basic' || !encoded) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Bollywoodless Admin"');
    res.status(401).json({ error: 'Admin credentials required' });
    return;
  }

  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  if (
    separatorIndex < 0 ||
    !safeCompare(username, adminUsername) ||
    !safeCompare(password, adminPassword)
  ) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Bollywoodless Admin"');
    res.status(401).json({ error: 'Invalid admin credentials' });
    return;
  }

  next();
}

module.exports = {
  adminAuth
};
