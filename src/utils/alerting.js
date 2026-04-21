const DEFAULT_TIMEOUT_MS = 8000;

export async function sendOpsAlert(title, payload = {}) {
  const webhook = process.env.ALERT_WEBHOOK_URL;
  if (!webhook) {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const body = {
      title,
      at: new Date().toISOString(),
      ...payload
    };

    const res = await fetch(webhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    return res.ok;
  } catch (error) {
    console.error('[Alerting] Failed to send alert:', error?.message || error);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
