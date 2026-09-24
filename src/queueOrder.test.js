import { expect, test } from 'bun:test';
import { moveItemsBefore } from './queueOrder';

test('drops insert and rearrange without duplicating queued items', () => {
  expect(moveItemsBefore(['A', 'B'], ['X'], 'B', true)).toEqual(['A', 'X', 'B']);
  expect(moveItemsBefore(['A', 'B', 'X'], ['X', 'X'], 'A', true)).toEqual(['X', 'A', 'B']);
  expect(moveItemsBefore(['A', 'B'], ['A'], null)).toEqual(['B', 'A']);
  expect(moveItemsBefore([], ['X'], null, true)).toEqual(['X']);
});
test('a stale drag preserves new items and cannot restore consumed items', () => {
  expect(moveItemsBefore(['B', 'C', 'D'], ['C', 'A'], 'B')).toEqual(['C', 'B', 'D']);
  expect(moveItemsBefore([], ['A'], null)).toEqual([]);
  expect(moveItemsBefore(['A', 'B'], ['A'], 'A')).toEqual(['A', 'B']);
});
