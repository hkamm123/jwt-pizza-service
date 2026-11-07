const crypto = require('crypto');
const os = require('os');
const config = require('./config.js');

// Unique per process, so each ECS task gets its own series in Grafana
// (e.g. while old and new tasks overlap during a rolling deploy).
const instanceId = crypto.randomUUID();

const requestsByMethod = { GET: 0, POST: 0, PUT: 0, DELETE: 0 };
let totalRequests = 0;

const authAttempts = { success: 0, failure: 0 };

let pizzasSold = 0;
let pizzaFailures = 0;
let revenue = 0; // in bitcoin, like the menu prices

const ACTIVE_USERS_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const activeUsers = new Map(); // Map of userId to last activity timestamp

const startTimeUnixNano = toUnixNano(Date.now());

function requestTracker(req, res, next) {
  requestsByMethod[req.method] = (requestsByMethod[req.method] ?? 0) + 1;
  totalRequests++;
  next();
}

function userActive(userId) {
  activeUsers.set(userId, Date.now());
}

function userLoggedOut(userId) {
  activeUsers.delete(userId);
}

// Any request with a valid token counts as activity. Login, register and
// logout don't arrive with a usable req.user, so authRouter calls
// userActive / userLoggedOut for those directly.
function activeUserTracker(req, res, next) {
  if (req.user) {
    userActive(req.user.id);
  }
  next();
}

function authAttempt(result) {
  authAttempts[result]++;
}

function pizzaPurchase(success, order) {
  if (success) {
    pizzasSold += order.items.length;
    revenue += order.items.reduce((sum, item) => sum + item.price, 0);
  } else {
    pizzaFailures += order.items.length;
  }
}

function getCpuUsagePercentage() {
  const load = os.loadavg()[0] / os.cpus().length;
  return round2(load * 100);
}

function getMemoryUsagePercentage() {
  const total = os.totalmem();
  const used = total - os.freemem();
  return round2((used / total) * 100);
}

function round2(n) {
  return Math.round(n * 100) / 100;
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

function counterMetric(name, unit, dataPoints) {
  return {
    name,
    unit,
    sum: {
      aggregationTemporality: 'AGGREGATION_TEMPORALITY_CUMULATIVE',
      isMonotonic: true,
      dataPoints,
    },
  };
}

function gaugeMetric(name, unit, dataPoints) {
  return { name, unit, gauge: { dataPoints } };
}

function buildPayload(now = Date.now()) {
  const timeUnixNano = toUnixNano(now);
  const point = (value, attributes = [], valueType = 'asInt') => ({
    [valueType]: value,
    startTimeUnixNano,
    timeUnixNano,
    attributes,
  });

  const byMethod = Object.entries(requestsByMethod).map(([method, count]) =>
    point(count, [attribute('method', method)]),
  );

  const byResult = Object.entries(authAttempts).map(([result, count]) =>
    point(count, [attribute('result', result)]),
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
              counterMetric('http_requests', '{request}', byMethod),
              counterMetric('http_requests_all', '{request}', [
                point(totalRequests),
              ]),
              counterMetric('auth_attempts', '{request}', byResult),
              counterMetric('pizzas_sold', '{pizza}', [point(pizzasSold)]),
              counterMetric('pizza_creation_failures', '{pizza}', [
                point(pizzaFailures),
              ]),
              counterMetric('pizza_revenue', '{BTC}', [
                point(revenue, [], 'asDouble'),
              ]),
              gaugeMetric('active_users', '{user}', [
                { asInt: countActiveUsers(now), timeUnixNano },
              ]),
              gaugeMetric('cpu_usage_percent', '%', [
                { asDouble: getCpuUsagePercentage(), timeUnixNano },
              ]),
              gaugeMetric('memory_usage_percent', '%', [
                { asDouble: getMemoryUsagePercentage(), timeUnixNano },
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
  userActive,
  userLoggedOut,
  authAttempt,
  pizzaPurchase,
  getCpuUsagePercentage,
  getMemoryUsagePercentage,
  buildPayload,
  sendMetrics,
  startMetrics,
};
