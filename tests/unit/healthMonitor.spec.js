import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('healthMonitor service', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('should probe website successfully when response is ok (HTTP 200)', async () => {
    const serviceId = 'website';
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200
    });
    vi.stubGlobal('fetch', fetchSpy);

    const metricsStore = await import('../../src/services/metricsStore.js');
    const recordCheckSpy = vi.spyOn(metricsStore, 'recordServiceCheck');
    const recordErrorSpy = vi.spyOn(metricsStore, 'recordServiceError');

    const { startWebsiteHealthMonitor } = await import('../../src/services/healthMonitor.js');
    startWebsiteHealthMonitor({ url: 'http://test-server.local/health', intervalMs: 30000, timeoutMs: 5000 });

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(fetchSpy).toHaveBeenCalledWith('http://test-server.local/health', expect.objectContaining({
      method: 'GET',
      redirect: 'follow'
    }));

    expect(recordCheckSpy).toHaveBeenCalledWith(serviceId, true, expect.objectContaining({
      statusCode: 200,
      responseMs: expect.any(Number)
    }));
    expect(recordErrorSpy).not.toHaveBeenCalled();
  });

  it('should record service error when response is not ok (HTTP 500)', async () => {
    const serviceId = 'website';
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500
    });
    vi.stubGlobal('fetch', fetchSpy);

    const metricsStore = await import('../../src/services/metricsStore.js');
    const recordCheckSpy = vi.spyOn(metricsStore, 'recordServiceCheck');
    const recordErrorSpy = vi.spyOn(metricsStore, 'recordServiceError');

    process.env.RENDER_EXTERNAL_URL = 'https://my-app.onrender.com';

    const { startWebsiteHealthMonitor } = await import('../../src/services/healthMonitor.js');
    startWebsiteHealthMonitor({ intervalMs: 30000, timeoutMs: 5000 });

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(fetchSpy).toHaveBeenCalledWith('https://my-app.onrender.com/health', expect.anything());

    expect(recordCheckSpy).toHaveBeenCalledWith(serviceId, false, expect.objectContaining({
      statusCode: 500
    }));
    expect(recordErrorSpy).toHaveBeenCalledWith(serviceId, 'Website status 500', expect.objectContaining({
      code: '500',
      url: 'https://my-app.onrender.com/health',
      statusCode: 500
    }));
  });

  it('should handle probe fetch network failures gracefully', async () => {
    const serviceId = 'website';
    const netErr = new Error('DNS lookup failed');
    netErr.name = 'FetchError';

    const fetchSpy = vi.fn().mockRejectedValue(netErr);
    vi.stubGlobal('fetch', fetchSpy);

    const metricsStore = await import('../../src/services/metricsStore.js');
    const recordCheckSpy = vi.spyOn(metricsStore, 'recordServiceCheck');
    const recordErrorSpy = vi.spyOn(metricsStore, 'recordServiceError');

    process.env.PUBLIC_BASE_URL = 'https://example.com/';

    const { startWebsiteHealthMonitor } = await import('../../src/services/healthMonitor.js');
    startWebsiteHealthMonitor({ intervalMs: 30000 });

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/health', expect.anything());

    expect(recordCheckSpy).toHaveBeenCalledWith(serviceId, false, expect.objectContaining({
      statusCode: null
    }));
    expect(recordErrorSpy).toHaveBeenCalledWith(serviceId, 'Website check failed', expect.objectContaining({
      code: 'FetchError',
      url: 'https://example.com/health',
      message: 'DNS lookup failed'
    }));
  });

  it('should use WEBSITE_HEALTH_URL when explicitly set in environment', async () => {
    delete process.env.RENDER_EXTERNAL_URL;
    delete process.env.PUBLIC_BASE_URL;
    process.env.WEBSITE_HEALTH_URL = 'https://explicit-health.com/ping';

    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);

    const { startWebsiteHealthMonitor } = await import('../../src/services/healthMonitor.js');
    startWebsiteHealthMonitor();

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(fetchSpy).toHaveBeenCalledWith('https://explicit-health.com/ping', expect.anything());
  });

  it('should default to localhost:3000/health when no env vars or PORT are set', async () => {
    delete process.env.WEBSITE_HEALTH_URL;
    delete process.env.RENDER_EXTERNAL_URL;
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.PORT;

    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);

    const { startWebsiteHealthMonitor } = await import('../../src/services/healthMonitor.js');
    startWebsiteHealthMonitor();

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:3000/health', expect.anything());
  });

  it('should default to localhost with custom PORT when set', async () => {
    delete process.env.WEBSITE_HEALTH_URL;
    delete process.env.RENDER_EXTERNAL_URL;
    delete process.env.PUBLIC_BASE_URL;
    process.env.PORT = '8080';

    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);

    const { startWebsiteHealthMonitor } = await import('../../src/services/healthMonitor.js');
    startWebsiteHealthMonitor();

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:8080/health', expect.anything());
  });

  it('should fallback error code to NETWORK_ERROR when thrown error lacks a name', async () => {
    const serviceId = 'website';
    const fetchSpy = vi.fn().mockRejectedValue('Simple string exception');
    vi.stubGlobal('fetch', fetchSpy);

    const metricsStore = await import('../../src/services/metricsStore.js');
    const recordErrorSpy = vi.spyOn(metricsStore, 'recordServiceError');

    const { startWebsiteHealthMonitor } = await import('../../src/services/healthMonitor.js');
    startWebsiteHealthMonitor({ url: 'http://test-server.local/health' });

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(recordErrorSpy).toHaveBeenCalledWith(serviceId, 'Website check failed', expect.objectContaining({
      code: 'NETWORK_ERROR',
      message: 'Simple string exception'
    }));
  });

  it('should guard against duplicate monitor starts (singleton pattern)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);

    const { startWebsiteHealthMonitor } = await import('../../src/services/healthMonitor.js');

    // Call start multiple times
    startWebsiteHealthMonitor({ url: 'http://first-call.local/health' });
    startWebsiteHealthMonitor({ url: 'http://second-call.local/health' });

    await new Promise(resolve => setTimeout(resolve, 50));

    // Only the first call should trigger fetch
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('http://first-call.local/health', expect.anything());
  });

  it('should clamp intervalMs and timeoutMs to minimum bounds and trigger recurring probes', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);

    const { startWebsiteHealthMonitor } = await import('../../src/services/healthMonitor.js');

    // Pass options below lower bounds (e.g., intervalMs = 100, timeoutMs = 5)
    startWebsiteHealthMonitor({ url: 'http://test-server.local/health', intervalMs: 100, timeoutMs: 5 });

    // Initial run triggers probe immediately
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Advance timers by less than the clamped interval (30,000ms)
    await vi.advanceTimersByTimeAsync(15000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Advance past the 30,000ms minimum threshold
    await vi.advanceTimersByTimeAsync(15000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
