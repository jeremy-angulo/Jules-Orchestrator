import { test, expect } from 'vitest';
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

test('metricsStore - recordServiceError helper', async () => {
    const serviceId = 'test-error-service-vitest-' + Date.now();
    const errorMsg = 'Critical failure Vitest';

    await metricsStore.recordServiceError(serviceId, errorMsg);

    const errors = await metricsStore.listServiceErrors(serviceId, 1, 10);
    expect(errors.length).toBe(1);
    expect(errors[0].error_message).toBe(errorMsg);
    expect(errors[0].ok).toBe(0);
});

test('metricsStore - dashboard metrics', async () => {
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
