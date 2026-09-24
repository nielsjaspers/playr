import { expect, test } from 'bun:test';
import { createLibraryRefresh } from './libraryRefresh';

test('shares scans until a mutation occurs, then rejects the old result', async () => {
  const refresh = createLibraryRefresh();
  const old = Promise.withResolvers();
  const applied = [];
  const first = refresh.run(async (isCurrent) => {
    await old.promise;
    if (isCurrent()) applied.push('old');
  });
  expect(refresh.run(async () => { throw new Error('Duplicate scan'); })).toBe(first);
  refresh.invalidate();
  await refresh.run(async (isCurrent) => { if (isCurrent()) applied.push('new'); });
  old.resolve();
  await first;
  expect(applied).toEqual(['new']);
});
