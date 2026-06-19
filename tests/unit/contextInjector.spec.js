import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildContextBlock } from '../../src/utils/contextInjector.js';
import { executeWithRetry } from '../../src/db/core.js';
import { getTokenStatusSummary } from '../../src/api/tokenRotation.js';

vi.mock('../../src/db/core.js', () => ({
  executeWithRetry: vi.fn()
}));

vi.mock('../../src/api/tokenRotation.js', () => ({
  getTokenStatusSummary: vi.fn()
}));

describe('contextInjector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-05-20T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('builds a basic context block for a single instance', async () => {
    executeWithRetry.mockResolvedValue({ rows: [] });
    getTokenStatusSummary.mockResolvedValue({ keys: [], totalUsage24h: 0 });

    const context = await buildContextBlock({ projectId: 'p1', agentName: 'a1' });

    expect(context).toContain('## Orchestrator Live Context');
    expect(context).toContain('- **Today\'s date:** 2024-05-20');
    expect(context).not.toContain('Parallel slot');
  });

  it('includes parallel slot info when totalInstances > 1', async () => {
    executeWithRetry.mockResolvedValue({ rows: [] });
    getTokenStatusSummary.mockResolvedValue({ keys: [], totalUsage24h: 0 });

    const context = await buildContextBlock({
      projectId: 'p1',
      agentName: 'a1',
      instanceIndex: 0,
      totalInstances: 2
    });

    expect(context).toContain('- **Parallel slot:** 1 of 2 — prioritize files and directories whose names start with **A–M**');

    const context2 = await buildContextBlock({
        projectId: 'p1',
        agentName: 'a1',
        instanceIndex: 1,
        totalInstances: 2
      });

      expect(context2).toContain('- **Parallel slot:** 2 of 2 — prioritize files and directories whose names start with **N–Z**');
  });

  it('includes recent session history', async () => {
    const now = Date.now();
    executeWithRetry.mockResolvedValue({
      rows: [
        { summary: 'Fixed bug X', pr_url: 'https://github/pr/1', ended_at: now - 10 * 60000 },
        { summary: 'Refactored Y', pr_url: null, ended_at: now - 60 * 60000 }
      ]
    });
    getTokenStatusSummary.mockResolvedValue({ keys: [], totalUsage24h: 0 });

    const context = await buildContextBlock({ projectId: 'p1', agentName: 'a1' });

    expect(context).toContain('- **Your last sessions (avoid duplicating this work):**');
    expect(context).toContain('10m ago: Fixed bug X → https://github/pr/1');
    expect(context).toContain('60m ago: Refactored Y');
  });

  it('includes API budget remaining', async () => {
    executeWithRetry.mockResolvedValue({ rows: [] });
    getTokenStatusSummary.mockResolvedValue({
      keys: [
        { limit24h: 100 },
        { limit24h: 15 }
      ],
      totalUsage24h: 50
    });

    const context = await buildContextBlock({ projectId: 'p1', agentName: 'a1' });

    expect(context).toContain('- **API budget remaining today:** 65 sessions');
  });

  it('handles database errors gracefully', async () => {
    executeWithRetry.mockRejectedValue(new Error('DB Error'));
    getTokenStatusSummary.mockResolvedValue({ keys: [], totalUsage24h: 0 });

    const context = await buildContextBlock({ projectId: 'p1', agentName: 'a1' });

    expect(context).toContain('## Orchestrator Live Context');
    expect(context).not.toContain('Your last sessions');
  });

  it('handles token status errors gracefully', async () => {
    executeWithRetry.mockResolvedValue({ rows: [] });
    getTokenStatusSummary.mockRejectedValue(new Error('API Error'));

    const context = await buildContextBlock({ projectId: 'p1', agentName: 'a1' });

    expect(context).toContain('## Orchestrator Live Context');
    expect(context).not.toContain('API budget remaining');
  });
});
