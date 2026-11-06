const request = require('supertest');
const config = require('../src/config.js');
const app = require('../src/service.js');
const metrics = require('../src/metrics.js');

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
  const resourceAttr = payload.resourceMetrics[0].resource.attributes[0];
  expect(resourceAttr).toEqual({ key: 'service.name', value: { stringValue: 'test-service' } });

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
