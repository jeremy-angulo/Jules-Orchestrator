import { test, expect, vi } from 'vitest';
import * as metricsStore from '../../src/services/metricsStore.js';

test('metricsStore - API call recording and summary', async () => {
    const token = 'test-token-vitest';
    const agent = 'test-agent-vitest';

    await metricsStore.recordApiCall(token, agent);

    const summary = await metricsStore.getApiUsageSummary24h();
    expect(summary.total).toBeGreaterThanOrEqual(1);

    const agentEntry = summary.byAgent.find(a => a.agentName === agent);
    expect(agentEntry).toBeDefined();
    expect(agentEntry.total).toBeGreaterThanOrEqual(1);

    const tokenEntry = summary.byToken.find(t => t.token === token);
    expect(tokenEntry).toBeDefined();
    expect(tokenEntry.total).toBeGreaterThanOrEqual(1);

    const usage = await metricsStore.getTokenUsage24h(token);
    expect(usage).toBeGreaterThanOrEqual(1);
});

test('metricsStore - service checks and uptime', async () => {
    const serviceId = 'test-service-vitest-' + Date.now();

    await metricsStore.recordServiceCheck(serviceId, true, { statusCode: 200, responseMs: 100 });
    await metricsStore.recordServiceCheck(serviceId, false, { statusCode: 500, responseMs: 50 });

    const checks = await metricsStore.listServiceChecks(serviceId, 10);
    expect(checks.length).toBe(2);
    expect(checks[0].ok).toBe(0);
    expect(checks[1].ok).toBe(1);

    const uptime = await metricsStore.getServiceUptime(serviceId, 1);
    expect(uptime.uptimePercent).toBe(50);

    const errorSummary = await metricsStore.getServiceErrorSummary(serviceId, 1);
    expect(errorSummary.errors).toBe(1);
});

test('metricsStore - recordServiceError helper and listServiceErrors', async () => {
    const serviceId = 'test-error-service-vitest-' + Date.now();
    const errorMsg = 'Critical failure Vitest';

    // 1. String source
    await metricsStore.recordServiceError(serviceId, errorMsg, 'custom-source');

    // 2. Object source (to test JSON.stringify logic)
    await metricsStore.recordServiceError(serviceId, errorMsg, { payload: 'detailed-info' });

    const errors = await metricsStore.listServiceErrors(serviceId, 1, 10);
    expect(errors.length).toBe(2);
    expect(errors[0].error_message).toBe(errorMsg);
    expect(errors[0].ok).toBe(0);
    expect(errors[0].source).toBe(JSON.stringify({ payload: 'detailed-info' }));
    expect(errors[1].source).toBe('custom-source');
});

test('metricsStore - default parameters for recordServiceCheck', async () => {
    const serviceId = 'test-default-service-' + Date.now();
    await metricsStore.recordServiceCheck(serviceId, true); // No options provided

    const checks = await metricsStore.listServiceChecks(serviceId, 1);
    expect(checks.length).toBe(1);
    expect(checks[0].ok).toBe(1);
    expect(checks[0].response_ms).toBe(0);
    expect(checks[0].error_message).toBeNull();
    expect(checks[0].source).toBe('monitor');
});

test('metricsStore - getServiceUptime with 0 records fallback', async () => {
    const emptyServiceId = 'empty-service-vitest-' + Date.now();
    const uptime = await metricsStore.getServiceUptime(emptyServiceId, 1);
    expect(uptime.uptimePercent).toBe(100);
});

test('metricsStore - dashboard metrics and batching', async () => {
    const key = 'test-metric-vitest-' + Date.now();

    await metricsStore.recordDashboardMetric(key, 42);
    await metricsStore.recordDashboardMetric(key, 84);

    const metrics = await metricsStore.listDashboardMetrics(key, 1);
    expect(metrics.length).toBe(2);
    expect(metrics[0].value).toBe(42);
    expect(metrics[1].value).toBe(84);

    const batch = await metricsStore.listDashboardMetricsBatch([key], 1);
    expect(batch[key]).toBeDefined();
    expect(batch[key].length).toBe(2);
});

test('metricsStore - ring buffer capping and drop-oldest behavior', async () => {
    const cappingKey = 'capped-metric-' + Date.now();

    // Loop 1005 times to exceed the 1000 limit of makeRing(1_000) for dashboard metrics
    for (let i = 0; i < 1005; i++) {
        await metricsStore.recordDashboardMetric(cappingKey, i);
    }

    const metrics = await metricsStore.listDashboardMetrics(cappingKey, 24);
    expect(metrics.length).toBe(1000);
    // The first 5 should be shifted out, so the first remaining item should be 5
    expect(metrics[0].value).toBe(5);
    expect(metrics[999].value).toBe(1004);
});
