const request = require('supertest');
const config = require('../src/config.js');
const app = require('../src/service.js');
const metrics = require('../src/metrics.js');
const { registerDiner } = require('../src/testUtils.js');

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

  // Registering doesn't send a token, so it doesn't count as activity.
  // An authenticated request afterwards does.
  async function activeDiner() {
    const { user, token } = await registerDiner();
    await request(app).get('/api/user/me').set('Authorization', `Bearer ${token}`);
    return { user, token };
  }

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
