import { describe, it, expect, vi, beforeEach } from 'vitest';
import esmock from 'esmock';

describe('agents.js DB', () => {
  let agentsDb;
  let mockExecute;
  let mockCache;

  beforeEach(async () => {
    mockExecute = vi.fn();
    mockCache = {
      agentListCache: { data: null },
      invalidateAgentCache: vi.fn(),
    };

    agentsDb = await esmock('../../src/db/agents.js', {
      '../../src/db/core.js': { executeWithRetry: mockExecute },
      '../../src/db/cache.js': mockCache,
    });
  });

  describe('listAgents', () => {
    it('should return cached agents and not hit the database if cache.data is set', async () => {
      const cachedData = [{ id: 1, name: 'Agent 1' }];
      mockCache.agentListCache.data = cachedData;

      const result = await agentsDb.listAgents();

      expect(result).toEqual(cachedData);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should query the database, populate the cache, and return agents if cache.data is null', async () => {
      const dbRows = [{ id: 2, name: 'Agent 2', sort_order: 1 }];
      mockExecute.mockResolvedValue({ rows: dbRows });

      const result = await agentsDb.listAgents();

      expect(result).toEqual(dbRows);
      expect(mockExecute).toHaveBeenCalledWith('SELECT * FROM agents ORDER BY sort_order ASC, name ASC');
      expect(mockCache.agentListCache.data).toEqual(dbRows);
    });
  });

  describe('getAgent', () => {
    it('should find and return an agent by matching string/number IDs', async () => {
      const dbRows = [
        { id: 1, name: 'Agent 1' },
        { id: 'custom-2', name: 'Agent 2' },
      ];
      mockExecute.mockResolvedValue({ rows: dbRows });

      // Match number ID 1 with string '1'
      const agent1 = await agentsDb.getAgent('1');
      expect(agent1).toEqual(dbRows[0]);

      // Match string ID 'custom-2'
      const agent2 = await agentsDb.getAgent('custom-2');
      expect(agent2).toEqual(dbRows[1]);

      // Handle non-existent ID
      const nonExistent = await agentsDb.getAgent('999');
      expect(nonExistent).toBeUndefined();
    });
  });

  describe('createAgent', () => {
    it('should create an agent with auto-generated ID, invalidate cache, and return lastInsertRowid', async () => {
      const newAgent = {
        name: 'New Agent',
        description: 'New Description',
        prompt: 'Be helpful',
        color: 'blue',
        sort_order: 5,
      };

      mockExecute.mockResolvedValue({ lastInsertRowid: 456 });

      const result = await agentsDb.createAgent(newAgent);

      expect(result).toBe(456);
      expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('INSERT INTO agents (name, description, prompt, color, sort_order, created_at, updated_at)'),
        args: expect.arrayContaining([
          newAgent.name,
          newAgent.description,
          newAgent.prompt,
          newAgent.color,
          newAgent.sort_order,
          expect.any(Number),
          expect.any(Number),
        ]),
      }));
      expect(mockCache.invalidateAgentCache).toHaveBeenCalled();
    });

    it('should default sort_order to 0 if not provided', async () => {
      const newAgent = {
        name: 'No Sort Order Agent',
        description: 'Desc',
        prompt: 'Prompt',
        color: 'red',
      };

      mockExecute.mockResolvedValue({ lastInsertRowid: 789 });

      const result = await agentsDb.createAgent(newAgent);

      expect(result).toBe(789);
      expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
        args: expect.arrayContaining([
          newAgent.name,
          newAgent.description,
          newAgent.prompt,
          newAgent.color,
          0, // sort_order defaulted to 0
          expect.any(Number),
          expect.any(Number),
        ]),
      }));
    });

    it('should create an agent with custom ID, invalidate cache, and return the custom ID', async () => {
      const newAgent = {
        id: 'my-custom-id',
        name: 'Custom Agent',
        description: 'Custom Desc',
        prompt: 'Custom Prompt',
        color: 'green',
        sort_order: 10,
      };

      mockExecute.mockResolvedValue({ lastInsertRowid: undefined });

      const result = await agentsDb.createAgent(newAgent);

      expect(result).toBe('my-custom-id');
      expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('INSERT INTO agents (id, name, description, prompt, color, sort_order, created_at, updated_at)'),
        args: expect.arrayContaining([
          newAgent.id,
          newAgent.name,
          newAgent.description,
          newAgent.prompt,
          newAgent.color,
          newAgent.sort_order,
          expect.any(Number),
          expect.any(Number),
        ]),
      }));
      expect(mockCache.invalidateAgentCache).toHaveBeenCalled();
    });
  });

  describe('updateAgent', () => {
    it('should update agent details, invalidate cache, and set updated_at timestamp', async () => {
      const updateData = {
        name: 'Updated Name',
        description: 'Updated Desc',
        prompt: 'Updated Prompt',
        color: 'yellow',
      };

      await agentsDb.updateAgent('agent-id-123', updateData);

      expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('UPDATE agents SET name=?, description=?, prompt=?, color=?, updated_at=? WHERE id=?'),
        args: [
          updateData.name,
          updateData.description,
          updateData.prompt,
          updateData.color,
          expect.any(Number),
          'agent-id-123',
        ],
      }));
      expect(mockCache.invalidateAgentCache).toHaveBeenCalled();
    });
  });

  describe('deleteAgent', () => {
    it('should delete an agent by ID and invalidate the cache', async () => {
      await agentsDb.deleteAgent('agent-id-to-delete');

      expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
        sql: 'DELETE FROM agents WHERE id = ?',
        args: ['agent-id-to-delete'],
      }));
      expect(mockCache.invalidateAgentCache).toHaveBeenCalled();
    });
  });

  describe('reorderAgents', () => {
    it('should update sort_order for each ID and invalidate cache', async () => {
      const ids = ['agent-a', 'agent-b', 'agent-c'];

      await agentsDb.reorderAgents(ids);

      expect(mockExecute).toHaveBeenCalledTimes(3);
      expect(mockExecute).toHaveBeenNthCalledWith(1, expect.objectContaining({
        sql: 'UPDATE agents SET sort_order = ? WHERE id = ?',
        args: [0, 'agent-a'],
      }));
      expect(mockExecute).toHaveBeenNthCalledWith(2, expect.objectContaining({
        sql: 'UPDATE agents SET sort_order = ? WHERE id = ?',
        args: [1, 'agent-b'],
      }));
      expect(mockExecute).toHaveBeenNthCalledWith(3, expect.objectContaining({
        sql: 'UPDATE agents SET sort_order = ? WHERE id = ?',
        args: [2, 'agent-c'],
      }));
      expect(mockCache.invalidateAgentCache).toHaveBeenCalled();
    });
  });
});
