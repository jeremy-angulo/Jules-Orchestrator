import { test, expect } from 'vitest';
import * as cache from '../../src/db/cache.js';

test('invalidateSiteCheckCache - clears specific project from maps', () => {
    cache.siteCheckStatsCache.set('p1', { some: 'data' });
    cache.siteCheckPagesCache.set('p1', [1, 2]);
    cache.siteCheckStatsCache.set('p2', { stay: 'here' });

    cache.invalidateSiteCheckCache('p1');

    expect(cache.siteCheckStatsCache.has('p1')).toBe(false);
    expect(cache.siteCheckPagesCache.has('p1')).toBe(false);
    expect(cache.siteCheckStatsCache.has('p2')).toBe(true);
});

test('invalidateProjectStateCache - clears specific project', () => {
    cache.projectStateCache.set('p1', 'active');
    cache.invalidateProjectStateCache('p1');
    expect(cache.projectStateCache.has('p1')).toBe(false);
});

test('invalidateProjectConfigCache - clears specific project', () => {
    cache.projectConfigCache.set('p1', { conf: true });
    cache.invalidateProjectConfigCache('p1');
    expect(cache.projectConfigCache.has('p1')).toBe(false);
});

test('invalidateAgentCache - clears agent data', () => {
    cache.agentListCache.data = [{ id: 1 }];
    cache.invalidateAgentCache();
    expect(cache.agentListCache.data).toBeNull();
});

test('invalidateAssignmentCache - clears project and "all" key', () => {
    cache.assignmentListCache.set('p1', [1]);
    cache.assignmentListCache.set('all', [1, 2]);
    cache.assignmentListCache.set('p2', [2]);

    cache.invalidateAssignmentCache('p1');

    expect(cache.assignmentListCache.has('p1')).toBe(false);
    expect(cache.assignmentListCache.has('all')).toBe(false);
    expect(cache.assignmentListCache.has('p2')).toBe(true);
});
