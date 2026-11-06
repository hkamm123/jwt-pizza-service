const request = require('supertest');
const config = require('../src/config.js');
const app = require('../src/service.js');
const metrics = require('../src/metrics.js');
const { DB } = require('../src/database/database.js');
const { registerDiner, login, loginUser } = require('../src/testUtils.js');

const realMetricsConfig = config.metrics;

beforeAll(() => {
  // Fake settings so nothing real is used or sent
  config.metrics = { source: 'test-service', endpointUrl: 'https://example.com/otlp', accountId: '123', apiKey: 'key' };
});

afterAll(() => {
  config.metrics = realMetricsConfig;
});

afterEach(() => {
  jest.restoreAllMocks();
});

function countsFrom(payload) {
  const [byMethod, all] = payload.resourceMetrics[0].scopeMetrics[0].metrics;
  const methods = Object.fromEntries(byMethod.sum.dataPoints.map((p) => [p.attributes[0].value.stringValue, p.asInt]));
  return { methods, total: all.sum.dataPoints[0].asInt };
}

test('counts requests by method and in total', async () => {
  const before = countsFrom(metrics.buildPayload());

  await request(app).get('/');
  await request(app).get('/');
  await request(app).post('/nothing-here');
  await request(app).delete('/nothing-here');

  const after = countsFrom(metrics.buildPayload());
  expect(after.methods.GET - before.methods.GET).toBe(2);
  expect(after.methods.POST - before.methods.POST).toBe(1);
  expect(after.methods.DELETE - before.methods.DELETE).toBe(1);
  expect(after.methods.PUT - before.methods.PUT).toBe(0);
  expect(after.total - before.total).toBe(4);
});

test('payload is a cumulative OTLP counter', () => {
  const payload = metrics.buildPayload(1700000000000);
  const [serviceName, instance] = payload.resourceMetrics[0].resource.attributes;
  expect(serviceName).toEqual({ key: 'service.name', value: { stringValue: 'test-service' } });
  expect(instance.key).toBe('service.instance.id');
  expect(instance.value.stringValue).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  const [byMethod, all] = payload.resourceMetrics[0].scopeMetrics[0].metrics;
  expect(byMethod.name).toBe('http_requests');
  expect(all.name).toBe('http_requests_all');
  expect(byMethod.sum.isMonotonic).toBe(true);
  expect(byMethod.sum.aggregationTemporality).toBe('AGGREGATION_TEMPORALITY_CUMULATIVE');
  expect(all.sum.dataPoints[0].timeUnixNano).toBe('1700000000000000000');
});

test('sendMetrics posts to Grafana with basic auth', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true });
  await metrics.sendMetrics();

  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe('https://example.com/otlp');
  expect(options.method).toBe('POST');
  expect(options.headers.Authorization).toBe(`Basic ${Buffer.from('123:key').toString('base64')}`);
  expect(JSON.parse(options.body).resourceMetrics).toBeDefined();
});

test('sendMetrics logs instead of throwing on failure', async () => {
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 401, text: async () => 'bad token' });
  await metrics.sendMetrics();
  expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('401'));

  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
  await expect(metrics.sendMetrics()).resolves.toBeUndefined();
});

test('startMetrics only runs when configured', () => {
  const timer = metrics.startMetrics(60000);
  expect(timer).not.toBeNull();
  clearInterval(timer);

  config.metrics = undefined;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  expect(metrics.startMetrics()).toBeNull();
});

describe('active users', () => {
  const TEN_MINUTES = 10 * 60 * 1000;

  // Registering counts as activity, so a fresh diner is already active.
  const activeDiner = registerDiner;

  function logout(token) {
    return request(app).delete('/api/auth').set('Authorization', `Bearer ${token}`);
  }

  test('registering counts as activity', async () => {
    const before = metrics.countActiveUsers();
    await registerDiner();
    expect(metrics.countActiveUsers() - before).toBe(1);
  });

  test('logging in counts as activity with no other requests', async () => {
    const { user, token, password } = await registerDiner();
    await logout(token);
    const before = metrics.countActiveUsers();

    await loginUser({ email: user.email, password });
    expect(metrics.countActiveUsers() - before).toBe(1);
  });

  test('a failed login does not count', async () => {
    const { user, token } = await registerDiner();
    await logout(token);
    const before = metrics.countActiveUsers();

    const loginRes = await login({ email: user.email, password: 'wrong' });
    expect(loginRes.status).not.toBe(200);
    expect(metrics.countActiveUsers()).toBe(before);
  });

  test('counts a user once no matter how many requests they make', async () => {
    const before = metrics.countActiveUsers();
    const { token } = await activeDiner();
    await request(app).get('/api/user/me').set('Authorization', `Bearer ${token}`);
    await request(app).get('/api/order').set('Authorization', `Bearer ${token}`);
    expect(metrics.countActiveUsers() - before).toBe(1);
  });

  test('does not count anonymous requests', async () => {
    const before = metrics.countActiveUsers();
    await request(app).get('/');
    await request(app).get('/api/order/menu');
    expect(metrics.countActiveUsers()).toBe(before);
  });

  test.each(['/api/auth', '/api/auth/'])('logout via DELETE %s removes the user', async (path) => {
    const before = metrics.countActiveUsers();
    const { token } = await activeDiner();
    expect(metrics.countActiveUsers() - before).toBe(1);

    const logoutRes = await request(app).delete(path).set('Authorization', `Bearer ${token}`);
    expect(logoutRes.status).toBe(200);
    expect(metrics.countActiveUsers()).toBe(before);
  });

  test('other DELETE requests keep the user active', async () => {
    const before = metrics.countActiveUsers();
    const { token } = await activeDiner();
    await request(app).delete('/api/franchise/999999').set('Authorization', `Bearer ${token}`);
    expect(metrics.countActiveUsers() - before).toBe(1);
  });

  test('users drop out after 10 minutes without a request', async () => {
    await activeDiner();
    expect(metrics.countActiveUsers()).toBeGreaterThan(0);
    expect(metrics.countActiveUsers(Date.now() + TEN_MINUTES - 1000)).toBeGreaterThan(0);
    expect(metrics.countActiveUsers(Date.now() + TEN_MINUTES + 1000)).toBe(0);
  });

  test('is sent as a gauge', async () => {
    await activeDiner();
    const metric = metrics.buildPayload().resourceMetrics[0].scopeMetrics[0].metrics.find((m) => m.name === 'active_users');
    expect(metric.sum).toBeUndefined();
    expect(metric.unit).toBe('{user}'); // unit '1' made Grafana name it active_users_ratio
    expect(metric.gauge.dataPoints[0].asInt).toBeGreaterThan(0);
    expect(metric.gauge.dataPoints[0].startTimeUnixNano).toBeUndefined();
  });
});

test('instance id is stable within a process and unique across processes', () => {
  const instanceIdOf = (m) => m.buildPayload().resourceMetrics[0].resource.attributes.find((a) => a.key === 'service.instance.id').value.stringValue;

  expect(instanceIdOf(metrics)).toBe(instanceIdOf(metrics));

  let otherProcess;
  jest.isolateModules(() => {
    otherProcess = require('../src/metrics.js');
  });
  expect(instanceIdOf(otherProcess)).not.toBe(instanceIdOf(metrics));
});

describe('auth attempts', () => {
  function authCounts() {
    const metric = metrics.buildPayload().resourceMetrics[0].scopeMetrics[0].metrics.find((m) => m.name === 'auth_attempts');
    return Object.fromEntries(metric.sum.dataPoints.map((p) => [p.attributes[0].value.stringValue, p.asInt]));
  }

  async function authCountChange(fn) {
    const before = authCounts();
    await fn();
    const after = authCounts();
    return { success: after.success - before.success, failure: after.failure - before.failure };
  }

  test('is a cumulative counter with success and failure from the start', () => {
    const metric = metrics.buildPayload().resourceMetrics[0].scopeMetrics[0].metrics.find((m) => m.name === 'auth_attempts');
    expect(metric.sum.isMonotonic).toBe(true);
    expect(Object.keys(authCounts()).sort()).toEqual(['failure', 'success']);
  });

  test('a successful login counts as a success', async () => {
    const { user, password } = await registerDiner();
    const change = await authCountChange(() => loginUser({ email: user.email, password }));
    expect(change).toEqual({ success: 1, failure: 0 });
  });

  test('a wrong password counts as a failure and still returns 401', async () => {
    const { user } = await registerDiner();
    let res;
    const change = await authCountChange(async () => {
      res = await login({ email: user.email, password: 'wrong' });
    });
    expect(change).toEqual({ success: 0, failure: 1 });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('unknown user');
  });

  test('an unknown email counts as a failure', async () => {
    const change = await authCountChange(() => login({ email: 'nobody@jwt.com', password: 'bad' }));
    expect(change).toEqual({ success: 0, failure: 1 });
  });

  test('a missing password counts as a failure and still returns 400', async () => {
    let res;
    const change = await authCountChange(async () => {
      res = await login({ email: 'nobody@jwt.com' });
    });
    expect(change).toEqual({ success: 0, failure: 1 });
    expect(res.status).toBe(400);
  });

  test('a server error is not counted as a failed login', async () => {
    jest.spyOn(DB, 'getUser').mockRejectedValue(new Error('database is down'));
    let res;
    const change = await authCountChange(async () => {
      res = await login({ email: 'nobody@jwt.com', password: 'bad' });
    });
    expect(change).toEqual({ success: 0, failure: 0 });
    expect(res.status).toBe(500);
  });

  test('registering is not an auth attempt', async () => {
    const change = await authCountChange(() => registerDiner());
    expect(change).toEqual({ success: 0, failure: 0 });
  });
});
