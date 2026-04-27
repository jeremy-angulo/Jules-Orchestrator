import { recordServiceCheck, recordServiceError } from '../db/database.js';

let websiteMonitorStarted = false;

function getWebsiteHealthUrl() {
  const explicit = String(process.env.WEBSITE_HEALTH_URL || '').trim();
  if (explicit) return explicit;

  const external = String(process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_BASE_URL || '').trim();
  if (external) {
    return external.endsWith('/') ? `${external}health` : `${external}/health`;
  }

  // Fallback to local health check if running locally
  return 'http://localhost:' + (process.env.PORT || 3000) + '/health';
}

async function probeWebsite(url, timeoutMs) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal
    });
    const responseMs = Date.now() - startedAt;
    const ok = response.ok;

    recordServiceCheck('website', ok, {
      statusCode: response.status,
      responseMs
    });

    if (!ok) {
      recordServiceError('website', `Website status ${response.status}`, {
        code: String(response.status),
        url,
        statusCode: response.status,
        responseMs
      });
    }
  } catch (error) {
    const responseMs = Date.now() - startedAt;
    recordServiceCheck('website', false, {
      statusCode: null,
      responseMs
    });
    recordServiceError('website', 'Website check failed', {
      code: error?.name || 'NETWORK_ERROR',
      url,
      responseMs,
      message: String(error?.message || error)
    });
  } finally {
    clearTimeout(timer);
  }
}

export function startWebsiteHealthMonitor(options = {}) {
  if (websiteMonitorStarted) {
    return;
  }

  websiteMonitorStarted = true;
  const url = String(options.url || getWebsiteHealthUrl());
  const intervalMs = Math.max(30_000, Number(options.intervalMs) || 120_000);
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || 10_000);

  const run = () => probeWebsite(url, timeoutMs);
  run();
  setInterval(run, intervalMs).unref();
}
