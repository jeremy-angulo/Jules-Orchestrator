/**
 * metricsStore.js
 *
 * In-memory store for ephemeral monitoring data that does NOT need to survive
 * a restart: API call logs, service health checks, and dashboard time-series.
 *
 * Replaces the Turso tables: api_calls_log, service_checks, dashboard_metrics.
 * Same async API as the database.js functions — callers require no changes
 * except updating their import path.
 *
 * Caps:
 *   api_calls_log   — last 20 000 entries  (≈ ~1MB RAM for a busy deployment)
 *   service_checks  — last 500 per service (plenty for 24h uptime charts)
 *   dashboard_metrics — last 1 000 per key  (≈ 83h at 5-min cadence)
 */

// ── Ring buffer helper ────────────────────────────────────────────────────────

function makeRing(maxSize) {
  const buf = [];
  return {
    push(item) {
      buf.push(item);
      if (buf.length > maxSize) buf.shift();
    },
    since(ts)        { return buf.filter(r => r.timestamp >= ts); },
    last(n)          { return buf.slice(-n); },
    all()            { return buf; },
  };
}

// ── api_calls_log ─────────────────────────────────────────────────────────────

const _apiCalls = makeRing(20_000);

export async function recordApiCall(token, agentName) {
  _apiCalls.push({ token, agentName, timestamp: Date.now() });
}

export async function getApiUsageSummary24h() {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const rows = _apiCalls.since(since);
  let total = 0;
  const agentMap = new Map();
  const tokenMap = new Map();
  for (const r of rows) {
    total++;
    agentMap.set(r.agentName, (agentMap.get(r.agentName) || 0) + 1);
    tokenMap.set(r.token,     (tokenMap.get(r.token)     || 0) + 1);
  }
  const byAgent = [...agentMap.entries()].sort((a, b) => b[1] - a[1]).map(([agentName, t]) => ({ agentName, total: t }));
  const byToken = [...tokenMap.entries()].sort((a, b) => b[1] - a[1]).map(([token, t]) => ({ token, total: t }));
  return { total, byAgent, byToken };
}

export async function getTokenUsage24h(token) {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  return _apiCalls.since(since).filter(r => r.token === token).length;
}

// ── service_checks ────────────────────────────────────────────────────────────

const _serviceChecks = new Map(); // serviceId → Ring

function getServiceRing(serviceId) {
  if (!_serviceChecks.has(serviceId)) _serviceChecks.set(serviceId, makeRing(500));
  return _serviceChecks.get(serviceId);
}

let _serviceCheckIdSeq = 0;

export async function recordServiceCheck(serviceId, ok, { statusCode = 200, responseMs = 0, errorMessage = null, source = 'monitor' } = {}) {
  getServiceRing(serviceId).push({
    id: ++_serviceCheckIdSeq,
    service: serviceId,
    ok: ok ? 1 : 0,
    response_ms: responseMs,
    error_message: errorMessage,
    timestamp: Date.now(),
    source,
  });
}

export async function recordServiceError(serviceId, error, source = 'monitor') {
  const sourceStr = typeof source === 'object' && source !== null ? JSON.stringify(source) : String(source);
  await recordServiceCheck(serviceId, false, { errorMessage: String(error), source: sourceStr });
}

export async function listServiceChecks(serviceId, limit = 50) {
  return getServiceRing(serviceId).all().slice(-limit).reverse();
}

export async function getServiceErrorSummary(serviceId, hours = 24) {
  const since = Date.now() - hours * 60 * 60 * 1000;
  const errors = getServiceRing(serviceId).since(since).filter(r => !r.ok).length;
  return { serviceId, errors, windowHours: hours };
}

export async function listServiceErrors(serviceId, hours = 24, limit = 50) {
  const since = Date.now() - hours * 60 * 60 * 1000;
  return getServiceRing(serviceId).since(since).filter(r => !r.ok).slice(-limit).reverse();
}

export async function getServiceUptime(serviceId, hours = 24) {
  const since = Date.now() - hours * 60 * 60 * 1000;
  const rows = getServiceRing(serviceId).since(since);
  const count = rows.length;
  const okCount = rows.filter(r => r.ok).length;
  return { uptimePercent: count === 0 ? 100 : (okCount / count) * 100 };
}

// ── dashboard_metrics ─────────────────────────────────────────────────────────

const _metrics = new Map(); // key → Ring

function getMetricRing(key) {
  if (!_metrics.has(key)) _metrics.set(key, makeRing(1_000));
  return _metrics.get(key);
}

export async function recordDashboardMetric(key, val) {
  getMetricRing(key).push({ timestamp: Date.now(), value: Number(val) });
}

export async function listDashboardMetrics(key, hours = 24) {
  const since = Date.now() - hours * 3_600_000;
  return getMetricRing(key).since(since).map(r => ({ timestamp: r.timestamp, value: r.value }));
}

export async function listDashboardMetricsBatch(keys, hours = 24) {
  const since = Date.now() - hours * 3_600_000;
  return Object.fromEntries(
    keys.map(k => [k, getMetricRing(k).since(since).map(r => ({ timestamp: r.timestamp, value: r.value }))])
  );
}
