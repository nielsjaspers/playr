import { expect, test } from 'bun:test';
import { episodeProgressLabel } from './episodeProgress';
const progress = { fileId: 'episode', position: 3314, duration: 3752, completedAt: null, updatedAt: 0 };
test('remembered episodes show the resume point and time remaining', () => {
  expect(episodeProgressLabel(progress, true)).toBe('55:14 · 7:18 left');
  expect(episodeProgressLabel({ ...progress, completedAt: 1 }, true)).toBe('1:02:32 · 0:00 left');
  expect(episodeProgressLabel({ ...progress, duration: 0 }, true)).toBe('Continue at 55:14');
});
test('folders with timestamps disabled do not expose saved positions', () => {
  expect(episodeProgressLabel(progress, false)).toBeNull();
  expect(episodeProgressLabel(undefined, true)).toBeNull();
});
