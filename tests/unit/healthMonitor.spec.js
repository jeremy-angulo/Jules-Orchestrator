import { test, expect, vi } from 'vitest';
import esmock from 'esmock';

test('healthMonitor - startWebsiteHealthMonitor triggers probe and records success', async () => {
    let recordedCheck = null;
    const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
    });

    vi.stubGlobal('fetch', mockFetch);

    const healthMonitor = await esmock('../../src/services/healthMonitor.js', {
        '../../src/services/metricsStore.js': {
            recordServiceCheck: async (type, ok, data) => {
                recordedCheck = { type, ok, data };
            },
            recordServiceError: async () => {}
        }
    });

    healthMonitor.startWebsiteHealthMonitor({
        url: 'http://test.com/health',
        intervalMs: 100000,
        timeoutMs: 1000
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockFetch).toHaveBeenCalledWith('http://test.com/health', expect.any(Object));
    expect(recordedCheck).toMatchObject({
        type: 'website',
        ok: true,
        data: { statusCode: 200 }
    });

    vi.unstubAllGlobals();
});

test('healthMonitor - records error on non-ok response', async () => {
    let recordedError = null;
    const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
    });

    vi.stubGlobal('fetch', mockFetch);

    const healthMonitor = await esmock('../../src/services/healthMonitor.js', {
        '../../src/services/metricsStore.js': {
            recordServiceCheck: async () => {},
            recordServiceError: async (type, msg, data) => {
                recordedError = { type, msg, data };
            }
        }
    });

    healthMonitor.startWebsiteHealthMonitor({
        url: 'http://test.com/health',
        intervalMs: 100000
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(recordedError).toMatchObject({
        type: 'website',
        msg: 'Website status 500',
        data: { statusCode: 500 }
    });

    vi.unstubAllGlobals();
});

test('healthMonitor - records error on network failure', async () => {
    let recordedError = null;
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));

    vi.stubGlobal('fetch', mockFetch);

    const healthMonitor = await esmock('../../src/services/healthMonitor.js', {
        '../../src/services/metricsStore.js': {
            recordServiceCheck: async () => {},
            recordServiceError: async (type, msg, data) => {
                recordedError = { type, msg, data };
            }
        }
    });

    healthMonitor.startWebsiteHealthMonitor({
        url: 'http://test.com/health',
        intervalMs: 100000
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(recordedError).toMatchObject({
        type: 'website',
        msg: 'Website check failed',
        data: { message: 'Network failure' }
    });

    vi.unstubAllGlobals();
});

test('healthMonitor - already started monitor does not start again', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    const healthMonitor = await esmock('../../src/services/healthMonitor.js', {
        '../../src/services/metricsStore.js': {
            recordServiceCheck: async () => {},
            recordServiceError: async () => {}
        }
    });

    healthMonitor.startWebsiteHealthMonitor({ url: 'http://first.com', intervalMs: 100000 });
    healthMonitor.startWebsiteHealthMonitor({ url: 'http://second.com', intervalMs: 100000 });

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockFetch).toHaveBeenCalledWith('http://first.com', expect.any(Object));
    expect(mockFetch).not.toHaveBeenCalledWith('http://second.com', expect.any(Object));

    vi.unstubAllGlobals();
});

test('healthMonitor - resolves WEBSITE_HEALTH_URL env fallback correctly', async () => {
    vi.stubEnv('WEBSITE_HEALTH_URL', 'http://env-health.com');
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    const healthMonitor = await esmock('../../src/services/healthMonitor.js', {
        '../../src/services/metricsStore.js': {
            recordServiceCheck: async () => {},
            recordServiceError: async () => {}
        }
    });

    healthMonitor.startWebsiteHealthMonitor({ intervalMs: 100000 });

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(mockFetch).toHaveBeenCalledWith('http://env-health.com', expect.any(Object));

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

test('healthMonitor - resolves RENDER_EXTERNAL_URL env fallback with trailing slash correctly', async () => {
    vi.stubEnv('WEBSITE_HEALTH_URL', '');
    vi.stubEnv('RENDER_EXTERNAL_URL', 'https://render-test.com/');
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    const healthMonitor = await esmock('../../src/services/healthMonitor.js', {
        '../../src/services/metricsStore.js': {
            recordServiceCheck: async () => {},
            recordServiceError: async () => {}
        }
    });

    healthMonitor.startWebsiteHealthMonitor({ intervalMs: 100000 });

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(mockFetch).toHaveBeenCalledWith('https://render-test.com/health', expect.any(Object));

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

test('healthMonitor - resolves RENDER_EXTERNAL_URL env fallback without trailing slash correctly', async () => {
    vi.stubEnv('WEBSITE_HEALTH_URL', '');
    vi.stubEnv('RENDER_EXTERNAL_URL', 'https://render-test.com');
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    const healthMonitor = await esmock('../../src/services/healthMonitor.js', {
        '../../src/services/metricsStore.js': {
            recordServiceCheck: async () => {},
            recordServiceError: async () => {}
        }
    });

    healthMonitor.startWebsiteHealthMonitor({ intervalMs: 100000 });

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(mockFetch).toHaveBeenCalledWith('https://render-test.com/health', expect.any(Object));

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

test('healthMonitor - resolves PUBLIC_BASE_URL fallback correctly', async () => {
    vi.stubEnv('WEBSITE_HEALTH_URL', '');
    vi.stubEnv('RENDER_EXTERNAL_URL', '');
    vi.stubEnv('PUBLIC_BASE_URL', 'http://public-base.com');
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    const healthMonitor = await esmock('../../src/services/healthMonitor.js', {
        '../../src/services/metricsStore.js': {
            recordServiceCheck: async () => {},
            recordServiceError: async () => {}
        }
    });

    healthMonitor.startWebsiteHealthMonitor({ intervalMs: 100000 });

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(mockFetch).toHaveBeenCalledWith('http://public-base.com/health', expect.any(Object));

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

test('healthMonitor - resolves PORT fallback correctly', async () => {
    vi.stubEnv('WEBSITE_HEALTH_URL', '');
    vi.stubEnv('RENDER_EXTERNAL_URL', '');
    vi.stubEnv('PUBLIC_BASE_URL', '');
    vi.stubEnv('PORT', '4000');
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    const healthMonitor = await esmock('../../src/services/healthMonitor.js', {
        '../../src/services/metricsStore.js': {
            recordServiceCheck: async () => {},
            recordServiceError: async () => {}
        }
    });

    healthMonitor.startWebsiteHealthMonitor({ intervalMs: 100000 });

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:4000/health', expect.any(Object));

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

test('healthMonitor - resolves local default fallback correctly if all unset', async () => {
    vi.stubEnv('WEBSITE_HEALTH_URL', '');
    vi.stubEnv('RENDER_EXTERNAL_URL', '');
    vi.stubEnv('PUBLIC_BASE_URL', '');
    vi.stubEnv('PORT', '');
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    const healthMonitor = await esmock('../../src/services/healthMonitor.js', {
        '../../src/services/metricsStore.js': {
            recordServiceCheck: async () => {},
            recordServiceError: async () => {}
        }
    });

    healthMonitor.startWebsiteHealthMonitor({ intervalMs: 100000 });

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/health', expect.any(Object));

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});
