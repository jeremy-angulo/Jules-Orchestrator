import test from 'node:test';
import assert from 'node:assert';
import { hasPermission, isValidRole } from '../src/auth/permissions.js';

test('isValidRole validates known roles', () => {
  assert.strictEqual(isValidRole('admin'), true);
  assert.strictEqual(isValidRole('operator'), true);
  assert.strictEqual(isValidRole('viewer'), true);
  assert.strictEqual(isValidRole('unknown'), false);
});

test('permissions enforce role boundaries', () => {
  assert.strictEqual(hasPermission('admin', 'users.manage'), true);
  assert.strictEqual(hasPermission('operator', 'users.manage'), false);
  assert.strictEqual(hasPermission('operator', 'agents.control'), true);
  assert.strictEqual(hasPermission('viewer', 'dashboard.read'), true);
  assert.strictEqual(hasPermission('viewer', 'agents.control'), false);
});
