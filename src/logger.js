const config = require('./config');

const MASK = '*****';
// These keys are removed from logged data, wherever they appear.
const SECRET_KEYS = ['password', 'token', 'jwt', 'apikey', 'authorization', 'email'];
// An object with any of these keys is a user, so its `name` is removed too.
// (Franchises and stores also have a `name`, and those are kept.)
const USER_KEYS = ['email', 'password', 'roles'];
// Catches emails inside free text, e.g. "unknown user for franchise admin a@jwt.com".
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

class Logger {
  httpLogger = (req, res, next) => {
    let send = res.send;
    res.send = (resBody) => {
      const logData = {
        authorized: !!req.headers.authorization,
        path: this.sanitizePath(req.originalUrl),
        method: req.method,
        statusCode: res.statusCode,
        reqBody: req.body,
        resBody: this.parseBody(resBody),
      };
      const level = this.statusToLogLevel(res.statusCode);
      this.log(level, 'http', logData);
      res.send = send;
      return res.send(resBody);
    };
    next();
  };

  log(level, type, logData) {
    const labels = { component: config.logging.source, level: level, type: type };
    const values = [this.nowString(), JSON.stringify(this.sanitize(logData))];
    const logEvent = { streams: [{ stream: labels, values: [values] }] };

    this.sendLogToGrafana(logEvent);
  }

  statusToLogLevel(statusCode) {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'warn';
    return 'info';
  }

  nowString() {
    return (Math.floor(Date.now()) * 1000000).toString();
  }

  parseBody(body) {
    if (typeof body !== 'string') return body;
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }

  // GET /api/user?name=... filters users by name, so drop the filter.
  sanitizePath(path) {
    if (!path.startsWith('/api/user')) return path;
    const url = new URL(path, 'http://localhost');
    url.searchParams.delete('name');
    return url.pathname + url.search;
  }

  sanitize(value) {
    // An email inside free text can't be removed as a key, so mask it in place.
    if (typeof value === 'string') return value.replace(EMAIL_PATTERN, MASK);
    if (Array.isArray(value)) return value.map((item) => this.sanitize(item));
    if (value && typeof value === 'object') {
      const keys = Object.keys(value).map((key) => key.toLowerCase());
      const isUser = keys.some((key) => USER_KEYS.includes(key));
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => {
            const lowerKey = key.toLowerCase();
            return !SECRET_KEYS.includes(lowerKey) && !(isUser && lowerKey === 'name');
          })
          .map(([key, item]) => [key, this.sanitize(item)])
      );
    }
    return value;
  }

  sendLogToGrafana(event) {
    const body = JSON.stringify(event);
    fetch(`${config.logging.endpointUrl}`, {
      method: 'post',
      body: body,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.logging.accountId}:${config.logging.apiKey}`,
      },
    }).then((res) => {
      if (!res.ok) console.log('Failed to send log to Grafana');
    });
  }
}
module.exports = new Logger();