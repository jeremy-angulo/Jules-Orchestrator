export const ROLES = {
  ADMIN: 'admin',
  OPERATOR: 'operator',
  VIEWER: 'viewer'
};

const PERMISSIONS = {
  [ROLES.ADMIN]: new Set([
    'dashboard.read',
    'runners.stop',
    'runners.killAfter',
    'agents.control',
    'project.lock',
    'project.resetTasks',
    'pipeline.run',
    'issues.runOnce',
    'background.runOnce',
    'customLoop.start',
    'prs.merge',
    'users.read',
    'users.manage',
    'schedulers.control',
    'audit.read',
    'analytics.read',
    'keys.read'
  ]),
  [ROLES.OPERATOR]: new Set([
    'dashboard.read',
    'runners.stop',
    'runners.killAfter',
    'agents.control',
    'pipeline.run',
    'issues.runOnce',
    'background.runOnce',
    'customLoop.start',
    'prs.merge',
    'audit.read',
    'analytics.read',
    'keys.read'
  ]),
  [ROLES.VIEWER]: new Set([
    'dashboard.read',
    'audit.read',
    'analytics.read',
    'keys.read'
  ])
};

export function getRolePermissions(role) {
  return PERMISSIONS[role] || new Set();
}

export function hasPermission(role, permission) {
  return getRolePermissions(role).has(permission);
}

export function isValidRole(role) {
  return Object.values(ROLES).includes(role);
}
