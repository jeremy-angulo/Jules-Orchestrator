import { describe, it, expect } from 'vitest';
import { hasPermission, isValidRole, getRolePermissions } from '../../src/auth/permissions.js';

describe('permissions', () => {
  describe('isValidRole', () => {
    it('should return true for known roles', () => {
      expect(isValidRole('admin')).toBe(true);
      expect(isValidRole('operator')).toBe(true);
      expect(isValidRole('viewer')).toBe(true);
    });

    it('should return false for unknown/invalid roles', () => {
      expect(isValidRole('hacker')).toBe(false);
      expect(isValidRole(null)).toBe(false);
      expect(isValidRole(undefined)).toBe(false);
      expect(isValidRole('')).toBe(false);
    });
  });

  describe('getRolePermissions', () => {
    it('should return empty Set for unknown role', () => {
      const perms = getRolePermissions('unknown-role');
      expect(perms).toBeInstanceOf(Set);
      expect(perms.size).toBe(0);
    });

    it('should return permissions Set for admin', () => {
      const perms = getRolePermissions('admin');
      expect(perms).toBeInstanceOf(Set);
      expect(perms.has('users.manage')).toBe(true);
      expect(perms.has('runners.stop')).toBe(true);
    });

    it('should return permissions Set for operator', () => {
      const perms = getRolePermissions('operator');
      expect(perms).toBeInstanceOf(Set);
      expect(perms.has('users.manage')).toBe(false);
      expect(perms.has('runners.stop')).toBe(true);
    });

    it('should return permissions Set for viewer', () => {
      const perms = getRolePermissions('viewer');
      expect(perms).toBeInstanceOf(Set);
      expect(perms.has('dashboard.read')).toBe(true);
      expect(perms.has('runners.stop')).toBe(false);
    });
  });

  describe('hasPermission', () => {
    it('should return true if role has the specific permission', () => {
      expect(hasPermission('admin', 'users.manage')).toBe(true);
      expect(hasPermission('operator', 'runners.stop')).toBe(true);
      expect(hasPermission('viewer', 'dashboard.read')).toBe(true);
    });

    it('should return false if role does not have the permission', () => {
      expect(hasPermission('operator', 'users.manage')).toBe(false);
      expect(hasPermission('viewer', 'runners.stop')).toBe(false);
    });

    it('should return false for unknown roles or permissions', () => {
      expect(hasPermission('unknown-role', 'dashboard.read')).toBe(false);
      expect(hasPermission('admin', 'nonexistent.permission')).toBe(false);
    });
  });
});