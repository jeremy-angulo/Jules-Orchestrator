import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import esmock from 'esmock';

test('healthMonitor - startWebsiteHealthMonitor triggers probe and records success', async () => {
    let recordedCheck = null;
    const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
    });

    // Globally mock fetch for this test
    vi.stubGlobal('fetch', mockFetch);

    const healthMonitor = await esmock('../../src/services/healthMonitor.js', {
        '../../src/services/metricsStore.js': {
            recordServiceCheck: async (type, ok, data) => {
                recordedCheck = { type, ok, data };
            },
            recordServiceError: async () => {}
        }
    });

    // Use a short interval and timeout for testing
    healthMonitor.startWebsiteHealthMonitor({
        url: 'http://test.com/health',
        intervalMs: 100000, // Long enough to not trigger again during test
        timeoutMs: 1000
    });

    // Wait for the immediate probe to finish
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
        data: { code: 'Error', message: 'Network failure' }
    });

    vi.unstubAllGlobals();
});
