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

test('resolveJsonConflict - merges arrays with deduplication', () => {
    const content = `<<<<<<< HEAD
{
  "list": [1, 2, 3]
}
=======
{
  "list": [3, 4, 5]
}
>>>>>>> DEV
`;
    const result = JSON.parse(resolveJsonConflict(content));
    expect(result.list).toEqual([1, 2, 3, 4, 5]);
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

test('resolveJsonConflict - throws error on invalid JSON after merge', () => {
    const content = `<<<<<<< HEAD
{ "a":
=======
{ "a": 1 }
>>>>>>> DEV
`;
    expect(() => resolveJsonConflict(content)).toThrow(SyntaxError);
});
