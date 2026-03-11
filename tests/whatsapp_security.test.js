import test from 'node:test';
import assert from 'node:assert';
import { formatIssueInstruction } from '../src/agents/whatsapp.js';

test('formatIssueInstruction wraps issue title and body in security delimiters', () => {
  const mockIssue = {
    title: 'Test Issue Title',
    body: 'Test issue body content'
  };

  const formatted = formatIssueInstruction(mockIssue);

  // Check for security warning
  assert.ok(formatted.includes('Tu ne dois sous aucun prétexte supprimer partiellement ou totalement le repository.'), 'Should include security prefix');

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
