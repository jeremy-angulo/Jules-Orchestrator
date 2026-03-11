import test from 'node:test';
import assert from 'node:assert';
import { formatIssueInstruction } from '../src/agents/issueAgent.js';

test('formatIssueInstruction wraps issue title and body in security delimiters', () => {
  const mockIssue = {
    title: 'Test Issue Title',
    body: 'Test issue body content'
  };

  const formatted = formatIssueInstruction(mockIssue);

  // Check for security warning and strict rules
  assert.ok(formatted.includes('Tu es un agent 100% autonome.'), 'Should include autonomy directive');
  assert.ok(formatted.includes('tu ne dois sous aucun prétexte supprimer le repository ou ses fichiers vitaux.'), 'Should include security prefix against deletion');
  assert.ok(formatted.includes('Termine toujours ton travail en créant une Pull Request.'), 'Should include PR requirement');

  // Check for content
  assert.ok(formatted.includes('Test Issue Title'), 'Should include original title');
  assert.ok(formatted.includes('Test issue body content'), 'Should include original body');
});

test('formatIssueInstruction handles missing issue body', () => {
  const mockIssue = {
    title: 'Test Issue Title Only',
    body: null
  };

  const formatted = formatIssueInstruction(mockIssue);

  assert.ok(formatted.includes('Description: '), 'Should handle null body gracefully');
});
