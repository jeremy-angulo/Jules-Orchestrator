import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendOpsAlert } from '../../src/utils/alerting.js';

describe('alerting.js - sendOpsAlert', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('ALERT_WEBHOOK_URL', 'https://mock-webhook.com');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('should return false if ALERT_WEBHOOK_URL is not set', async () => {
    vi.stubEnv('ALERT_WEBHOOK_URL', '');
    const result = await sendOpsAlert('Test Title');
    expect(result).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should send a POST request with correct body and return true on success', async () => {
    global.fetch.mockResolvedValue({ ok: true });

    const result = await sendOpsAlert('Test Title', { key: 'value' });

    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://mock-webhook.com',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('"title":"Test Title"'),
      })
    );

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.key).toBe('value');
    expect(body.at).toBeDefined();
    expect(new Date(body.at).getTime()).not.toBeNaN();
  });

  it('should return false if fetch response is not ok', async () => {
    global.fetch.mockResolvedValue({ ok: false });

    const result = await sendOpsAlert('Test Title');

    expect(result).toBe(false);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('should return false and log error on network failure', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch.mockRejectedValue(new Error('Network Error'));

    const result = await sendOpsAlert('Test Title');

    expect(result).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[Alerting] Failed to send alert:',
      'Network Error'
    );
    consoleSpy.mockRestore();
  });

  it('should handle abort/timeout', async () => {
    global.fetch.mockImplementation(() => new Promise((_, reject) => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
    }));

    const result = await sendOpsAlert('Test Title');
    expect(result).toBe(false);
  });
});
