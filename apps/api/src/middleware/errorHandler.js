function notFound(req, res) {
  res.status(404).json({
    error: 'Not found'
  });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  const statusCode =
    error.statusCode ||
    error.status ||
    (error.name === 'MulterError' || error.message?.includes('Multipart') ? 400 : 500);

  res.status(statusCode).json({
    error: error.message || 'Unexpected server error',
    code: error.code,
    details: error.details
  });
}

module.exports = {
  errorHandler,
  notFound
};
