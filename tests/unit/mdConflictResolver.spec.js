import { test, expect } from 'vitest';
import { resolveMarkdownConflict } from '../../src/utils/mdConflictResolver.js';

test('resolveMarkdownConflict - returns original content if no markers', () => {
    const content = '# Hello World';
    expect(resolveMarkdownConflict(content)).toBe(content);
});

test('resolveMarkdownConflict - concatenates head and dev content', () => {
    const content = `<<<<<<< HEAD
Line 1 from HEAD
=======
Line 1 from DEV
>>>>>>> DEV
`;
    const result = resolveMarkdownConflict(content);
    expect(result).toContain('Line 1 from HEAD');
    expect(result).toContain('Line 1 from DEV');
    // Implementation concatenates HEAD then DEV, and preserves trailing newline
    const expected = `Line 1 from HEAD
Line 1 from DEV
`;
    expect(result).toBe(expected);
});

test('resolveMarkdownConflict - handles multiple conflict blocks', () => {
    const content = `Intro
<<<<<<< HEAD
Head 1
=======
Dev 1
>>>>>>> DEV
Middle
<<<<<<< HEAD
Head 2
=======
Dev 2
>>>>>>> DEV
Outro`;
    const result = resolveMarkdownConflict(content);
    const expected = `Intro
Head 1
Dev 1
Middle
Head 2
Dev 2
Outro`;
    expect(result).toBe(expected);
});

test('resolveMarkdownConflict - handles empty sections', () => {
    const content = `<<<<<<< HEAD
=======
New content in DEV
>>>>>>> DEV
`;
    const result = resolveMarkdownConflict(content);
    expect(result).toBe('New content in DEV\n');
});
