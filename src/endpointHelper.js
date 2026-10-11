class StatusCodeError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

const asyncHandler = (fn) => (req, res, next) => {
  return Promise.resolve(fn(req, res, next)).catch(next);
};

function parseQueryInt(value) {
  if (value === undefined) {
    return value;
  }

  if (!/^\d+$/.test(value)) {
    throw new StatusCodeError('bad request', 400);
  }

  return Number(value);
}

module.exports = {
  asyncHandler,
  StatusCodeError,
  parseQueryInt,
};
