import { describe, it, expect, vi } from 'vitest';
import esmock from 'esmock';

const setupTokenRotation = async (config = {}, dbMocks = {}, metricsMocks = {}) => {
  return await esmock('../../src/api/tokenRotation.js', {
    '../../src/config.js': {
      GLOBAL_CONFIG: {
        JULES_MAIN_TOKEN: 'primary-token',
        JULES_SECONDARY_TOKENS: [],
        ...config
      }
    },
    '../../src/db/database.js': {
      getTokenName: vi.fn(async () => null),
      ...dbMocks
    },
    '../../src/services/metricsStore.js': {
      getTokenUsage24h: vi.fn(async () => 0),
      ...metricsMocks
    }
  });
};

describe('tokenRotation.js', () => {
  describe('getTokenInventory', () => {
    it('should correctly identify primary and secondary tokens and their limits', async () => {
      const { getTokenInventory } = await setupTokenRotation({
        JULES_SECONDARY_TOKENS: ['secondary-1']
      });

      const inventory = await getTokenInventory();

      expect(inventory).toHaveLength(2);
      expect(inventory[0]).toMatchObject({
        isPrimary: true,
        limit24h: 100,
        token: 'primary-token'
      });
      expect(inventory[1]).toMatchObject({
        isPrimary: false,
        limit24h: 15,
        token: 'secondary-1'
      });
    });

    it('should handle missing secondary tokens', async () => {
      const { getTokenInventory } = await setupTokenRotation({
        JULES_SECONDARY_TOKENS: undefined
      });

      const inventory = await getTokenInventory();
      expect(inventory).toHaveLength(1);
    });
  });

  describe('getTokenStatusSummary', () => {
    it('should return unconfigured status if no tokens', async () => {
      const { getTokenStatusSummary } = await setupTokenRotation({
        JULES_MAIN_TOKEN: ''
      });

      const summary = await getTokenStatusSummary();
      expect(summary.configured).toBe(false);
      expect(summary.healthy).toBe(false);
    });

    it('should return healthy summary with total usage', async () => {
      const { getTokenStatusSummary } = await setupTokenRotation(
        { JULES_SECONDARY_TOKENS: ['s1'] },
        {},
        { getTokenUsage24h: vi.fn(async (t) => t === 'primary-token' ? 10 : 5) }
      );

      const summary = await getTokenStatusSummary();
      expect(summary.configured).toBe(true);
      expect(summary.totalUsage24h).toBe(15);
      expect(summary.keys).toHaveLength(2);
    });
  });

  describe('getAvailableToken', () => {
    it('should throw error if no tokens are configured', async () => {
      const { getAvailableToken } = await setupTokenRotation({
        JULES_MAIN_TOKEN: ''
      });

      await expect(getAvailableToken('test-agent')).rejects.toThrow('JULES_MAIN_TOKEN is not configured.');
    });

    it('should pick preferred token by ID if available', async () => {
      const { getAvailableToken } = await setupTokenRotation({
        JULES_SECONDARY_TOKENS: ['s1', 's2']
      });

      const token = await getAvailableToken('test-agent', { preferredTokenId: 'key-2' });
      expect(token.token).toBe('s1');
    });

    it('should pick preferred token by index if available', async () => {
      const { getAvailableToken } = await setupTokenRotation({
        JULES_SECONDARY_TOKENS: ['s1', 's2']
      });

      const token = await getAvailableToken('test-agent', { preferredTokenId: '2' });
      expect(token.token).toBe('s2');
    });

    it('should pick token with lowest utilization among those below limits', async () => {
      // Primary: usage 50/100 (50%)
      // Secondary: usage 5/15 (33%) -> SHOULD BE PICKED
      const { getAvailableToken } = await setupTokenRotation(
        { JULES_SECONDARY_TOKENS: ['s1'] },
        {},
        {
          getTokenUsage24h: vi.fn(async (t) => {
            if (t === 'primary-token') return 50;
            if (t === 's1') return 5;
            return 0;
          })
        }
      );

      const token = await getAvailableToken('test-agent');
      expect(token.token).toBe('s1');
    });

    it('should fallback to lowest utilization overall if all tokens are at/above limit', async () => {
      // Primary: usage 110/100 (110%)
      // Secondary: usage 18/15 (120%)
      // Primary has lower utilization (1.1 vs 1.2)
      const { getAvailableToken } = await setupTokenRotation(
        { JULES_SECONDARY_TOKENS: ['s1'] },
        {},
        {
          getTokenUsage24h: vi.fn(async (t) => {
            if (t === 'primary-token') return 110;
            if (t === 's1') return 18;
            return 0;
          })
        }
      );

      const token = await getAvailableToken('test-agent');
      expect(token.token).toBe('primary-token');
    });

    it('should pick secondary if it has lower utilization even if primary is also above limit', async () => {
        // Primary: usage 150/100 (150%)
        // Secondary: usage 16/15 (106%) -> SHOULD BE PICKED
        const { getAvailableToken } = await setupTokenRotation(
          { JULES_SECONDARY_TOKENS: ['s1'] },
          {},
          {
            getTokenUsage24h: vi.fn(async (t) => {
              if (t === 'primary-token') return 150;
              if (t === 's1') return 16;
              return 0;
            })
          }
        );

        const token = await getAvailableToken('test-agent');
        expect(token.token).toBe('s1');
      });
  });
});
