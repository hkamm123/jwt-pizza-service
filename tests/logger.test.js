const express = require('express');
const request = require('supertest');
const config = require('../src/config.js');
const logger = require('../src/logger.js');

const realLoggingConfig = config.logging;

beforeAll(() => {
  // Fake settings so nothing real is used or sent
  config.logging = { source: 'test-service', endpointUrl: 'https://example.com/loki', accountId: '123', apiKey: 'key' };
});

afterAll(() => {
  config.logging = realLoggingConfig;
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Stops logs from being sent and returns the parsed log lines that would have been.
function captureLogs() {
  const sent = [];
  jest.spyOn(logger, 'sendLogToGrafana').mockImplementation((event) => {
    const stream = event.streams[0];
    sent.push({ labels: stream.stream, data: JSON.parse(stream.values[0][1]) });
  });
  return sent;
}

// A small app that uses the logger the same way service.js does.
function testApp() {
  const app = express();
  app.use(logger.httpLogger);
  app.use(express.json());
  app.put('/api/auth', (req, res) => {
    res.json({ user: { id: 1, name: 'pizza diner', email: 'd@jwt.com', roles: [{ role: 'diner' }] }, token: 'abc.def.ghi' });
  });
  app.get('/api/franchise', (req, res) => {
    res.send({ franchises: [{ id: 1, name: 'pizzaPocket', admins: [{ id: 3, name: 'franchisee', email: 'f@jwt.com' }] }] });
  });
  app.get('/missing', (req, res) => res.status(404).json({ message: 'unknown endpoint' }));
  app.get('/broken', (req, res) => res.status(500).send('plain text error'));
  return app;
}

describe('statusToLogLevel', () => {
  test.each([
    [200, 'info'],
    [302, 'info'],
    [400, 'warn'],
    [404, 'warn'],
    [500, 'error'],
    [503, 'error'],
  ])('%i is %s', (status, level) => {
    expect(logger.statusToLogLevel(status)).toBe(level);
  });
});

test('nowString is the current time in nanoseconds', () => {
  jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  expect(logger.nowString()).toBe('1700000000000000000');
});

describe('parseBody', () => {
  test('parses JSON strings', () => {
    expect(logger.parseBody('{"id":1}')).toEqual({ id: 1 });
  });

  test('returns non-JSON strings as they are', () => {
    expect(logger.parseBody('plain text')).toBe('plain text');
  });

  test('returns objects as they are', () => {
    const body = { id: 1 };
    expect(logger.parseBody(body)).toBe(body);
  });
});

describe('sanitizePath', () => {
  test('removes the name filter from user routes', () => {
    expect(logger.sanitizePath('/api/user?page=0&name=pizza*&limit=10')).toBe('/api/user?page=0&limit=10');
  });

  test('drops the query string when name was the only parameter', () => {
    expect(logger.sanitizePath('/api/user?name=pizza*')).toBe('/api/user');
  });

  test('keeps the name filter on other routes', () => {
    expect(logger.sanitizePath('/api/franchise?name=pizza*')).toBe('/api/franchise?name=pizza*');
  });
});

describe('sanitize', () => {
  test('removes secrets at any depth, ignoring key case', () => {
    const data = {
      password: 'a',
      Authorization: 'Bearer xyz',
      nested: { token: 't', jwt: 'j', apiKey: 'k', keep: 'yes' },
    };
    expect(logger.sanitize(data)).toEqual({ nested: { keep: 'yes' } });
  });

  test('removes user names and emails but keeps the user id', () => {
    const user = { id: 2, name: 'pizza diner', email: 'd@jwt.com', roles: [{ role: 'diner' }] };
    expect(logger.sanitize(user)).toEqual({ id: 2, roles: [{ role: 'diner' }] });
  });

  test('treats an object with only a password as a user', () => {
    expect(logger.sanitize({ name: 'pizza diner', password: 'a' })).toEqual({});
  });

  test('keeps franchise and store names', () => {
    const franchise = { id: 1, name: 'pizzaPocket', stores: [{ id: 4, name: 'SLC' }] };
    expect(logger.sanitize(franchise)).toEqual(franchise);
  });

  test('masks emails inside text', () => {
    expect(logger.sanitize({ message: 'unknown user for franchise admin bob.smith+1@jwt.co.uk provided' })).toEqual({
      message: 'unknown user for franchise admin ***** provided',
    });
  });

  test('passes other values through', () => {
    expect(logger.sanitize(5)).toBe(5);
    expect(logger.sanitize(null)).toBeNull();
    expect(logger.sanitize(undefined)).toBeUndefined();
    expect(logger.sanitize([1, 'a', true])).toEqual([1, 'a', true]);
  });
});

test('log sends a sanitized Loki event', () => {
  const send = jest.spyOn(logger, 'sendLogToGrafana').mockImplementation(() => {});
  jest.spyOn(Date, 'now').mockReturnValue(1700000000000);

  logger.log('info', 'db', { userId: 2, email: 'd@jwt.com' });

  expect(send).toHaveBeenCalledWith({
    streams: [
      {
        stream: { component: 'test-service', level: 'info', type: 'db' },
        values: [['1700000000000000000', '{"userId":2}']],
      },
    ],
  });
});

describe('sendLogToGrafana', () => {
  const event = { streams: [] };

  // tests/setup.js mocks sendLogToGrafana; use the real one here; fetch is mocked instead.
  beforeEach(() => {
    logger.sendLogToGrafana.mockRestore();
  });

  test('posts the event to Grafana with the API key', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true });
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    logger.sendLogToGrafana(event);
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/loki', {
      method: 'post',
      body: JSON.stringify(event),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer 123:key' },
    });
    expect(consoleLog).not.toHaveBeenCalled();
  });

  test('reports when Grafana rejects the log', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false });
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    logger.sendLogToGrafana(event);
    await new Promise((resolve) => setImmediate(resolve));

    expect(consoleLog).toHaveBeenCalledWith('Failed to send log to Grafana');
  });

  test('reports network failures instead of crashing', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    logger.sendLogToGrafana(event);
    await new Promise((resolve) => setImmediate(resolve));

    expect(consoleLog).toHaveBeenCalledWith('Failed to send log to Grafana:', 'getaddrinfo ENOTFOUND');
  });
});

describe('httpLogger', () => {
  test('logs a sanitized request and response sent with res.json', async () => {
    const logs = captureLogs();

    const res = await request(testApp())
      .put('/api/auth')
      .set('Authorization', 'Bearer abc.def.ghi')
      .send({ email: 'd@jwt.com', password: 'diner' });

    expect(logs).toHaveLength(1);
    expect(logs[0].labels).toEqual({ component: 'test-service', level: 'info', type: 'http' });
    expect(logs[0].data).toEqual({
      authorized: true,
      path: '/api/auth',
      method: 'PUT',
      statusCode: 200,
      reqBody: {},
      resBody: { user: { id: 1, roles: [{ role: 'diner' }] } },
    });

    // Only the log is sanitized; the client still gets the full response.
    expect(res.body.token).toBe('abc.def.ghi');
    expect(res.body.user.email).toBe('d@jwt.com');
  });

  test('logs a response sent with res.send', async () => {
    const logs = captureLogs();

    await request(testApp()).get('/api/franchise');

    expect(logs[0].data.authorized).toBe(false);
    expect(logs[0].data.resBody).toEqual({ franchises: [{ id: 1, name: 'pizzaPocket', admins: [{ id: 3 }] }] });
  });

  test('logs client errors as warnings', async () => {
    const logs = captureLogs();

    await request(testApp()).get('/missing');

    expect(logs[0].labels.level).toBe('warn');
    expect(logs[0].data.statusCode).toBe(404);
  });

  test('logs server errors as errors and keeps text bodies', async () => {
    const logs = captureLogs();

    const res = await request(testApp()).get('/broken');

    expect(logs[0].labels.level).toBe('error');
    expect(logs[0].data.resBody).toBe('plain text error');
    expect(res.text).toBe('plain text error');
  });
});
