export const siteCheckStatsCache = new Map();
export const siteCheckPagesCache = new Map();
export const projectStateCache = new Map();
export const projectConfigCache = new Map();
export const agentListCache = { data: null };
export const assignmentListCache = new Map();
export const projectPromptsCache = new Map();

export function invalidateSiteCheckCache(projectId) {
  if (projectId) {
    siteCheckStatsCache.delete(projectId);
    siteCheckPagesCache.delete(projectId);
  }
}

export function invalidateProjectStateCache(projectId) {
  if (projectId) projectStateCache.delete(projectId);
}

export function invalidateProjectConfigCache(projectId) {
  if (projectId) projectConfigCache.delete(projectId);
}

export function invalidateAgentCache() {
  agentListCache.data = null;
}

export function invalidateAssignmentCache(projectId) {
  if (projectId) assignmentListCache.delete(projectId);
  assignmentListCache.delete('all');
}
