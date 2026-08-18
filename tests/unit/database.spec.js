import { describe, it, expect } from 'vitest';
import * as db from '../../src/db/database.js';

describe('Database Barrel Export (src/db/database.js)', () => {
  it('re-exports core database utilities', () => {
    expect(typeof db.client).toBe('object');
    expect(typeof db.executeWithRetry).toBe('function');
    expect(typeof db.batchWithRetry).toBe('function');
    expect(typeof db.pruneOldData).toBe('function');
  });

  it('re-exports tables functions', () => {
    expect(typeof db.initTables).toBe('function');
  });

  it('re-exports projects functions', () => {
    expect(typeof db.initProjectState).toBe('function');
    expect(typeof db.lockProject).toBe('function');
    expect(typeof db.unlockProject).toBe('function');
    expect(typeof db.incrementTasks).toBe('function');
    expect(typeof db.decrementTasks).toBe('function');
    expect(typeof db.setActiveTasks).toBe('function');
    expect(typeof db.isProjectLocked).toBe('function');
    expect(typeof db.getActiveTasks).toBe('function');
    expect(typeof db.getAllProjectStates).toBe('function');
    expect(typeof db.listProjectsConfig).toBe('function');
    expect(typeof db.getProjectConfig).toBe('function');
    expect(typeof db.upsertProjectConfig).toBe('function');
    expect(typeof db.updateProjectAutomation).toBe('function');
    expect(typeof db.deleteProjectConfig).toBe('function');
  });

  it('re-exports audit functions', () => {
    expect(typeof db.recordAuditEvent).toBe('function');
    expect(typeof db.listAuditEvents).toBe('function');
  });

  it('re-exports tokens functions', () => {
    expect(typeof db.listTokenNames).toBe('function');
    expect(typeof db.getTokenName).toBe('function');
    expect(typeof db.upsertTokenName).toBe('function');
  });

  it('re-exports users functions', () => {
    expect(typeof db.hasAnyDashboardUser).toBe('function');
    expect(typeof db.findUserByEmail).toBe('function');
    expect(typeof db.findUserById).toBe('function');
    expect(typeof db.createDashboardUser).toBe('function');
    expect(typeof db.createDashboardSession).toBe('function');
    expect(typeof db.findSessionWithUser).toBe('function');
    expect(typeof db.deleteDashboardSession).toBe('function');
    expect(typeof db.deleteExpiredSessions).toBe('function');
    expect(typeof db.listDashboardUsers).toBe('function');
    expect(typeof db.updateDashboardUserRole).toBe('function');
    expect(typeof db.updateDashboardUserPassword).toBe('function');
    expect(typeof db.deleteDashboardUser).toBe('function');
  });

  it('re-exports siteChecks functions', () => {
    expect(typeof db.getSiteCheckConfig).toBe('function');
    expect(typeof db.updateSiteCheckConfig).toBe('function');
    expect(typeof db.pickAndLockSitePage).toBe('function');
    expect(typeof db.lockSitePage).toBe('function');
    expect(typeof db.unlockSitePage).toBe('function');
    expect(typeof db.updateSitePageResult).toBe('function');
    expect(typeof db.markSitePageFixed).toBe('function');
    expect(typeof db.getSiteCheckStats).toBe('function');
    expect(typeof db.listSitePages).toBe('function');
    expect(typeof db.releaseStaleSitePageLocks).toBe('function');
  });

  it('re-exports agents functions', () => {
    expect(typeof db.listAgents).toBe('function');
    expect(typeof db.getAgent).toBe('function');
    expect(typeof db.createAgent).toBe('function');
    expect(typeof db.updateAgent).toBe('function');
    expect(typeof db.deleteAgent).toBe('function');
    expect(typeof db.reorderAgents).toBe('function');
  });

  it('re-exports assignments functions', () => {
    expect(typeof db.listAssignments).toBe('function');
    expect(typeof db.getAssignment).toBe('function');
    expect(typeof db.createAssignment).toBe('function');
    expect(typeof db.updateAssignment).toBe('function');
    expect(typeof db.deleteAssignment).toBe('function');
    expect(typeof db.deleteAssignmentsByProject).toBe('function');
    expect(typeof db.toggleAssignment).toBe('function');
    expect(typeof db.recordAssignmentRun).toBe('function');
  });

  it('re-exports prompts functions', () => {
    expect(typeof db.listPromptsByProject).toBe('function');
    expect(typeof db.getPrompt).toBe('function');
    expect(typeof db.upsertPrompt).toBe('function');
  });

  it('re-exports sessions functions', () => {
    expect(typeof db.recordAgentSessionStart).toBe('function');
    expect(typeof db.recordAgentSessionEnd).toBe('function');
    expect(typeof db.getAgentSessionsByStatus).toBe('function');
    expect(typeof db.listAgentSessions).toBe('function');
    expect(typeof db.getLastAgentSession).toBe('function');
    expect(typeof db.createJournalEntry).toBe('function');
    expect(typeof db.closeJournalEntry).toBe('function');
    expect(typeof db.getJournalEntry).toBe('function');
    expect(typeof db.listJournalByProject).toBe('function');
    expect(typeof db.listJournalByAssignment).toBe('function');
  });

  it('re-exports cache utilities and invalidate functions', () => {
    expect(typeof db.siteCheckStatsCache).toBe('object');
    expect(typeof db.siteCheckPagesCache).toBe('object');
    expect(typeof db.projectStateCache).toBe('object');
    expect(typeof db.projectConfigCache).toBe('object');
    expect(typeof db.agentListCache).toBe('object');
    expect(typeof db.assignmentListCache).toBe('object');
    expect(typeof db.projectPromptsCache).toBe('object');
    expect(typeof db.invalidateSiteCheckCache).toBe('function');
    expect(typeof db.invalidateProjectStateCache).toBe('function');
    expect(typeof db.invalidateProjectConfigCache).toBe('function');
    expect(typeof db.invalidateAgentCache).toBe('function');
    expect(typeof db.invalidateAssignmentCache).toBe('function');
  });
});
