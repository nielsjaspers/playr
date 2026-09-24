import { expect, test } from 'bun:test';
import { acceptPlayback, emptyPlaybackSession, getPlaybackTarget } from './playbackSession';
import { createPlaybackSequence } from './playbackSequence';

const sequence = createPlaybackSequence(['A', 'B', 'C'], 'Shows', 'A', false);
const playingA = acceptPlayback(emptyPlaybackSession, { id: 'A', source: 'library' }, sequence);
test('queue interrupts library playback and then resumes at its successor', () => {
  expect(getPlaybackTarget(playingA, ['X', 'Y'], 'A', 'next', 'off')).toEqual({ id: 'X', source: 'queue' });
  const playingX = acceptPlayback(playingA, { id: 'X', source: 'queue' });
  expect(getPlaybackTarget(playingX, ['Y'], 'X', 'finished', 'off')?.id).toBe('Y');
  const playingY = acceptPlayback(playingX, { id: 'Y', source: 'queue' });
  expect(getPlaybackTarget(playingY, [], 'Y', 'finished', 'off')?.id).toBe('B');
});
test('manual library selection preserves queue priority and changes the continuation', () => {
  const playingB = acceptPlayback(playingA, { id: 'B', source: 'library' }, sequence);
  expect(getPlaybackTarget(playingB, ['X'], 'B', 'next', 'off')?.id).toBe('X');
  expect(getPlaybackTarget(acceptPlayback(playingB, { id: 'X', source: 'queue' }), [], 'X', 'next', 'off')?.id).toBe('C');
});
test('previous skips queue history and returns to the library cursor', () => {
  const queued = acceptPlayback(playingA, { id: 'X', source: 'queue' });
  expect(getPlaybackTarget(queued, ['Y'], 'X', 'previous', 'off')?.id).toBe('A');
  const playingB = acceptPlayback(queued, { id: 'B', source: 'library' });
  expect(getPlaybackTarget(playingB, [], 'B', 'previous', 'off')?.id).toBe('A');
});
test('repeat one holds the current item and repeat all wraps only the library', () => {
  expect(getPlaybackTarget(playingA, ['X'], 'A', 'finished', 'one')?.id).toBe('A');
  const queued = acceptPlayback(playingA, { id: 'X', source: 'queue' });
  expect(getPlaybackTarget(queued, ['Y'], 'X', 'finished', 'one')?.id).toBe('X');
  const last = acceptPlayback(playingA, { id: 'C', source: 'library' });
  expect(getPlaybackTarget(last, [], 'C', 'finished', 'all')?.id).toBe('A');
  expect(getPlaybackTarget(last, [], 'C', 'finished', 'off')).toBeNull();
});
test('queue edits immediately determine the next item without altering the library cursor', () => {
  const queued = acceptPlayback(playingA, { id: 'X', source: 'queue' });
  expect(getPlaybackTarget(queued, ['Z', 'Y'], 'X', 'next', 'off')?.id).toBe('Z');
  expect(getPlaybackTarget(queued, [], 'X', 'next', 'off')?.id).toBe('B');
});
