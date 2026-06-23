import { describe, it, expect, vi } from 'vitest';
import * as tokens from '../../src/db/tokens.js';
import * as core from '../../src/db/core.js';

vi.mock('../../src/db/core.js', () => ({
  executeWithRetry: vi.fn(),
}));

describe('tokens.js', () => {
  describe('listTokenNames', () => {
    it('should call executeWithRetry with the correct SQL', async () => {
      const mockRows = [{ token_index: 0, custom_name: 'Primary' }];
      vi.mocked(core.executeWithRetry).mockResolvedValue({ rows: mockRows });

      const result = await tokens.listTokenNames();

      expect(core.executeWithRetry).toHaveBeenCalledWith('SELECT * FROM token_names');
      expect(result).toEqual(mockRows);
    });
  });

  describe('getTokenName', () => {
    it('should return custom_name if found', async () => {
      vi.mocked(core.executeWithRetry).mockResolvedValue({ rows: [{ custom_name: 'My Token' }] });

      const name = await tokens.getTokenName(0);

      expect(core.executeWithRetry).toHaveBeenCalledWith({
        sql: 'SELECT custom_name FROM token_names WHERE token_index = ?',
        args: [0]
      });
      expect(name).toBe('My Token');
    });

    it('should return null if not found', async () => {
      vi.mocked(core.executeWithRetry).mockResolvedValue({ rows: [] });

      const name = await tokens.getTokenName(99);

      expect(name).toBeNull();
    });
  });

  describe('upsertTokenName', () => {
    it('should call executeWithRetry with UPSERT SQL', async () => {
      await tokens.upsertTokenName(1, 'New Name');

      expect(core.executeWithRetry).toHaveBeenCalledWith({
        sql: expect.stringContaining('INSERT INTO token_names'),
        args: [1, 'New Name']
      });
      expect(core.executeWithRetry).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('ON CONFLICT(token_index) DO UPDATE SET custom_name = excluded.custom_name')
      }));
    });
  });
});
