import { describe, it, expect, vi } from 'vitest';
import * as audit from '../../src/db/audit.js';
import * as core from '../../src/db/core.js';

vi.mock('../../src/db/core.js', () => ({
  executeWithRetry: vi.fn(),
}));

describe('audit.js', () => {
  describe('recordAuditEvent', () => {
    it('should call executeWithRetry with the correct SQL and arguments', async () => {
      const evt = {
        userId: 'user-123',
        userEmail: 'test@example.com',
        action: 'TEST_ACTION',
        target: 'TEST_TARGET',
        details: { foo: 'bar' },
        ip: '127.0.0.1'
      };

      await audit.recordAuditEvent(evt);

      expect(core.executeWithRetry).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('INSERT INTO audit_log'),
        args: expect.arrayContaining([
          expect.any(Number), // timestamp
          evt.userId,
          evt.userEmail,
          evt.action,
          evt.target,
          JSON.stringify(evt.details),
          evt.ip
        ])
      }));
    });

    it('should handle null details', async () => {
        const evt = {
          userId: 'user-123',
          action: 'TEST_ACTION'
        };

        await audit.recordAuditEvent(evt);

        expect(core.executeWithRetry).toHaveBeenCalledWith(expect.objectContaining({
          args: expect.arrayContaining([
            expect.any(Number),
            evt.userId,
            undefined,
            evt.action,
            undefined,
            null,
            undefined
          ])
        }));
      });
  });

  describe('listAuditEvents', () => {
    it('should call executeWithRetry and parse details', async () => {
      const mockRows = [
        { id: 1, action: 'ACTION1', details: JSON.stringify({ a: 1 }) },
        { id: 2, action: 'ACTION2', details: null }
      ];
      vi.mocked(core.executeWithRetry).mockResolvedValue({ rows: mockRows });

      const events = await audit.listAuditEvents(24, 100);

      expect(core.executeWithRetry).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining('SELECT * FROM audit_log'),
        args: [expect.any(Number), 100]
      }));

      expect(events).toHaveLength(2);
      expect(events[0].details).toEqual({ a: 1 });
      expect(events[1].details).toBeNull();
    });
  });
});
