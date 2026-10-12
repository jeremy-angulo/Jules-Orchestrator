import { test, expect } from 'vitest';
import { resolveJsonConflict } from '../../src/utils/jsonConflictResolver.js';

test('resolveJsonConflict - returns original content if no markers', () => {
    const content = '{"a": 1}';
    expect(resolveJsonConflict(content)).toBe(content);
});

test('resolveJsonConflict - resolves simple scalar conflict (head wins)', () => {
    const content = `<<<<<<< HEAD
{
  "key": "value-head"
}
=======
{
  "key": "value-dev"
}
>>>>>>> DEV
`;
    const result = JSON.parse(resolveJsonConflict(content));
    expect(result.key).toBe('value-head');
});

test('resolveJsonConflict - merges objects (deep merge)', () => {
    const content = `<<<<<<< HEAD
{
  "shared": { "headOnly": 1, "both": "head" },
  "uniqueHead": 2
}
=======
{
  "shared": { "devOnly": 3, "both": "dev" },
  "uniqueDev": 4
}
>>>>>>> DEV
`;
    const result = JSON.parse(resolveJsonConflict(content));
    expect(result.shared.headOnly).toBe(1);
    expect(result.shared.devOnly).toBe(3);
    expect(result.shared.both).toBe('head'); // HEAD wins on scalar conflict
    expect(result.uniqueHead).toBe(2);
    expect(result.uniqueDev).toBe(4);
});

test('resolveJsonConflict - merges arrays with primitive deduplication and object concatenation', () => {
    const content = `<<<<<<< HEAD
{
  "list": [1, 2, { "a": 1 }, null]
}
=======
{
  "list": [2, 3, { "b": 2 }, null]
}
>>>>>>> DEV
`;
    const result = JSON.parse(resolveJsonConflict(content));
    expect(result.list).toEqual([1, 2, { "a": 1 }, null, 3, { "b": 2 }]);
});

test('resolveJsonConflict - handles null and undefined values in deep merge', () => {
    const content = `<<<<<<< HEAD
{
  "nullInDev": "presentInHead",
  "nullInHead": null
}
=======
{
  "nullInDev": null,
  "nullInHead": "presentInDev"
}
>>>>>>> DEV
`;
    const result = JSON.parse(resolveJsonConflict(content));
    expect(result.nullInDev).toBe('presentInHead');
    expect(result.nullInHead).toBe('presentInDev');
});

test('resolveJsonConflict - handles multiple conflict blocks', () => {
    const content = `{
  "a": 1,
<<<<<<< HEAD
  "b": 2,
=======
  "b": 3,
>>>>>>> DEV
  "c": 4,
<<<<<<< HEAD
  "d": 5
=======
  "d": 6
>>>>>>> DEV
}`;
    const result = JSON.parse(resolveJsonConflict(content));
    expect(result.a).toBe(1);
    expect(result.b).toBe(2); // head wins
    expect(result.c).toBe(4);
    expect(result.d).toBe(5); // head wins
});

test('resolveJsonConflict - handles conflict markers with empty sections', () => {
    const content = `<<<<<<< HEAD
=======
>>>>>>> DEV
`;
    expect(resolveJsonConflict(content)).toBe(content);
});

test('resolveJsonConflict - throws error on invalid JSON after merge', () => {
    const content = `<<<<<<< HEAD
{ "a":
=======
{ "a": 1 }
>>>>>>> DEV
`;
    expect(() => resolveJsonConflict(content)).toThrow(SyntaxError);
});
