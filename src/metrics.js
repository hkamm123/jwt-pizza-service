const crypto = require('crypto');
const config = require('./config.js');

// Unique per process, so each ECS task gets its own series in Grafana
// (e.g. while old and new tasks overlap during a rolling deploy).
const instanceId = crypto.randomUUID();

const requestsByMethod = { GET: 0, POST: 0, PUT: 0, DELETE: 0 };
let totalRequests = 0;

const ACTIVE_USERS_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const activeUsers = new Map(); // Map of userId to last activity timestamp

const startTimeUnixNano = toUnixNano(Date.now());

function requestTracker(req, res, next) {
  requestsByMethod[req.method] = (requestsByMethod[req.method] ?? 0) + 1;
  totalRequests++;
  next();
}

function isLogout(req) {
  return req.method === 'DELETE' && req.path.replace(/\/$/, '') === '/api/auth';
}

function activeUserTracker(req, res, next) {
  if (req.user) {
    if (isLogout(req)) {
      activeUsers.delete(req.user.id);
    } else {
      activeUsers.set(req.user.id, Date.now());
    }
  }
  next();
}

function countActiveUsers(now = Date.now()) {
  for (const [userId, lastSeen] of activeUsers) {
    if (now - lastSeen > ACTIVE_USERS_WINDOW_MS) {
      activeUsers.delete(userId);
    }
  }
  return activeUsers.size;
}

// OTLP wants nanoseconds. Date.now() * 1e6 is too big to hold exactly in a
// JS number, so build the value as a string instead.
function toUnixNano(ms) {
  return `${ms}000000`;
}

function attribute(key, value) {
  return { key, value: { stringValue: value } };
}

function counterMetric(name, dataPoints) {
  return {
    name,
    unit: '1',
    sum: {
      aggregationTemporality: 'AGGREGATION_TEMPORALITY_CUMULATIVE',
      isMonotonic: true,
      dataPoints,
    },
  };
}

function gaugeMetric(name, dataPoints) {
  return { name, unit: '1', gauge: { dataPoints } };
}

function buildPayload(now = Date.now()) {
  const timeUnixNano = toUnixNano(now);
  const point = (value, attributes = []) => ({
    asInt: value,
    startTimeUnixNano,
    timeUnixNano,
    attributes,
  });

  const byMethod = Object.entries(requestsByMethod).map(([method, count]) =>
    point(count, [attribute('method', method)]),
  );

  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            attribute(
              'service.name',
              config.metrics?.source ?? 'jwt-pizza-service',
            ),
            attribute('service.instance.id', instanceId),
          ],
        },
        scopeMetrics: [
          {
            metrics: [
              counterMetric('http_requests', byMethod),
              counterMetric('http_requests_all', [point(totalRequests)]),
              gaugeMetric('active_users', [
                { asInt: countActiveUsers(now), timeUnixNano },
              ]),
            ],
          },
        ],
      },
    ],
  };
}

async function sendMetrics() {
  const { endpointUrl, accountId, apiKey } = config.metrics;
  const auth = Buffer.from(`${accountId}:${apiKey}`).toString('base64');
  try {
    const res = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(buildPayload()),
    });
    if (!res.ok) {
      console.error(
        `Failed to push metrics to Grafana: ${res.status} ${await res.text()}`,
      );
    }
  } catch (err) {
    // Metrics are best effort; never let them crash the service.
    console.error('Error pushing metrics to Grafana:', err.message);
  }
}

// Push metrics on a timer. Called from index.js only, so tests don't send anything.
function startMetrics(periodMs = 10000) {
  if (!config.metrics?.apiKey) {
    console.log('Metrics disabled: no metrics config');
    return null;
  }
  const timer = setInterval(sendMetrics, periodMs);
  timer.unref(); // don't keep the process alive just for metrics
  return timer;
}

module.exports = {
  requestTracker,
  activeUserTracker,
  countActiveUsers,
  buildPayload,
  sendMetrics,
  startMetrics,
};
