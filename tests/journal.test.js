import { GLOBAL_CONFIG } from '../src/config.js';
process.env.ORCHESTRATOR_DB_PATH = 'test-journal.db';
GLOBAL_CONFIG.JULES_MAIN_TOKEN = 'test-token';
GLOBAL_CONFIG.JULES_SECONDARY_TOKENS = [];

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initTables,
  createJournalEntry,
  closeJournalEntry,
  getJournalEntry,
  listJournalByProject,
  listJournalByAssignment,
} from '../src/db/database.js';

const PROJECT_ID = 'test-journal-project';
const AGENT_NAME = 'Test Agent';
const SESSION_A = `session-journal-${Date.now()}-a`;
const SESSION_B = `session-journal-${Date.now()}-b`;

test('Journal — initTables crée la table journal', async () => {
  await initTables();
  // Si on arrive ici sans erreur, la table existe
  assert.ok(true);
});

test('Journal — createJournalEntry insère une entrée running', async () => {
  await createJournalEntry({
    sessionId: SESSION_A,
    assignmentId: 42,
    projectId: PROJECT_ID,
    agentName: AGENT_NAME,
    intent: 'Analyser les pages marketing et corriger les problèmes visuels.',
  });

  const entry = await getJournalEntry(SESSION_A);
  assert.ok(entry, 'L\'entrée doit exister');
  assert.equal(entry.session_id, SESSION_A);
  assert.equal(entry.project_id, PROJECT_ID);
  assert.equal(entry.agent_name, AGENT_NAME);
  assert.equal(entry.assignment_id, 42);
  assert.equal(entry.status, 'running');
  assert.equal(entry.intent, 'Analyser les pages marketing et corriger les problèmes visuels.');
  assert.equal(entry.summary, null);
  assert.equal(entry.ended_at, null);
});

test('Journal — closeJournalEntry met à jour summary et status', async () => {
  await closeJournalEntry(SESSION_A, {
    status: 'completed',
    summary: 'Session terminée avec succès — PR #123 créée et soumise pour merge.',
    prUrl: 'https://github.com/jeremy-angulo/HomeFreeWorld/pull/123',
    metadata: { pagesAnalyzed: 12, issuesFound: 3 },
  });

  const entry = await getJournalEntry(SESSION_A);
  assert.equal(entry.status, 'completed');
  assert.equal(entry.summary, 'Session terminée avec succès — PR #123 créée et soumise pour merge.');
  assert.equal(entry.pr_url, 'https://github.com/jeremy-angulo/HomeFreeWorld/pull/123');
  assert.ok(entry.ended_at, 'ended_at doit être renseigné');
  assert.deepEqual(entry.metadata, { pagesAnalyzed: 12, issuesFound: 3 });
});

test('Journal — entrée failed sans PR', async () => {
  await createJournalEntry({
    sessionId: SESSION_B,
    assignmentId: null,
    projectId: PROJECT_ID,
    agentName: AGENT_NAME,
    intent: null,
  });

  await closeJournalEntry(SESSION_B, {
    status: 'failed',
    summary: 'Erreur : Jules API returned 429',
  });

  const entry = await getJournalEntry(SESSION_B);
  assert.equal(entry.status, 'failed');
  assert.equal(entry.assignment_id, null);
  assert.equal(entry.pr_url, null);
  assert.equal(entry.metadata, null);
  assert.match(entry.summary, /429/);
});

test('Journal — listJournalByProject retourne les entrées du projet', async () => {
  const entries = await listJournalByProject(PROJECT_ID, 10);
  assert.ok(Array.isArray(entries));
  // Doit contenir au moins SESSION_A et SESSION_B
  const ids = entries.map(e => e.session_id);
  assert.ok(ids.includes(SESSION_A), 'SESSION_A doit apparaître');
  assert.ok(ids.includes(SESSION_B), 'SESSION_B doit apparaître');
  // Triées par started_at DESC — SESSION_B plus récente
  const idxA = ids.indexOf(SESSION_A);
  const idxB = ids.indexOf(SESSION_B);
  assert.ok(idxB < idxA, 'SESSION_B (plus récente) doit être avant SESSION_A');
});

test('Journal — listJournalByAssignment filtre par assignment_id', async () => {
  const entries = await listJournalByAssignment(42, 10);
  assert.ok(Array.isArray(entries));
  assert.ok(entries.every(e => e.assignment_id === 42), 'Toutes les entrées doivent avoir assignment_id=42');
  assert.ok(entries.some(e => e.session_id === SESSION_A));
});

test('Journal — getJournalEntry retourne null pour session inconnue', async () => {
  const entry = await getJournalEntry('session-inexistante-xyz');
  assert.equal(entry, null);
});
