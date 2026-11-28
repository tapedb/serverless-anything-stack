/**
 * A small expect() over node:assert, so the tests run under `node --test`
 * (and Bun) with no dependencies.
 */
import assert from "node:assert/strict";

function matchers(actual: unknown, negate: boolean) {
  const check = (ok: boolean, message: string) => assert.ok(negate ? !ok : ok, negate ? `not: ${message}` : message);
  const has = (item: unknown) =>
    typeof actual === "string" ? actual.includes(String(item)) : Array.isArray(actual) && actual.some((x) => x === item);
  return {
    toEqual: (expected: unknown) => (negate ? assert.notDeepStrictEqual(actual, expected) : assert.deepStrictEqual(actual, expected)),
    toBe: (expected: unknown) => (negate ? assert.notStrictEqual(actual, expected) : assert.strictEqual(actual, expected)),
    toContain: (item: unknown) => check(has(item), `${JSON.stringify(actual)} contains ${JSON.stringify(item)}`),
    toBeGreaterThan: (n: number) => check((actual as number) > n, `${actual} > ${n}`),
    toMatch: (re: RegExp) => check(re.test(String(actual)), `${actual} matches ${re}`),
    toStartWith: (prefix: string) => check(String(actual).startsWith(prefix), `${actual} starts with ${prefix}`),
  };
}

export function expect(actual: unknown) {
  return { ...matchers(actual, false), not: matchers(actual, true) };
}
