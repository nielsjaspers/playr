import { expect, test } from 'bun:test';
import { acceptPlayback, emptyPlaybackSession, getLibraryContinuation, getPlaybackTarget, removeLibraryContinuation } from './playbackSession';
import { createPlaybackSequence } from './playbackSequence';

const sequence = createPlaybackSequence(['A', 'B', 'C'], 'Shows', 'A', false);
const playingA = acceptPlayback(emptyPlaybackSession, { id: 'A', source: 'library' }, sequence);
test('dragging a library episode into the queue does not play it twice', () => {
  const promoted = removeLibraryContinuation(playingA, ['B']);
  expect(getLibraryContinuation(promoted, 'off')).toEqual(['C']);
  expect(getPlaybackTarget(promoted, ['B'], 'A', 'next', 'off')?.id).toBe('B');
  expect(getPlaybackTarget(acceptPlayback(promoted, { id: 'B', source: 'queue' }), [], 'B', 'next', 'off')?.id).toBe('C');
  expect(promoted.sequence.baseIds).toEqual(['A', 'B', 'C']);
  expect(removeLibraryContinuation(playingA, ['A']).libraryFileId).toBe('A');
});
test('upcoming library rows match one complete repeat cycle, including the current library position', () => {
  expect(getLibraryContinuation(playingA, 'off')).toEqual(['B', 'C']);
  expect(getLibraryContinuation(playingA, 'all')).toEqual(['B', 'C', 'A']);
  const queued = acceptPlayback(playingA, { id: 'X', source: 'queue' });
  expect(getLibraryContinuation(queued, 'all')).toEqual(['B', 'C', 'A']);
  const single = acceptPlayback(emptyPlaybackSession, { id: 'A', source: 'library' },
    createPlaybackSequence(['A'], '', 'A', false));
  expect(getLibraryContinuation(single, 'all')).toEqual(['A']);
});
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

test('moving continuation rows changes Next without changing the library or queue cursor', async () => {
  const { moveLibraryContinuation } = await import('./playbackSession');
  const moved = moveLibraryContinuation(playingA, ['C'], 'B', 'off');
  expect(getLibraryContinuation(moved, 'off')).toEqual(['C', 'B']);
  expect(getPlaybackTarget(moved, [], 'A', 'next', 'off')?.id).toBe('C');
  expect(getPlaybackTarget(moved, ['X'], 'A', 'next', 'off')?.id).toBe('X');
  expect(moved.sequence.baseIds).toEqual(['A', 'B', 'C']);
  const playingB = acceptPlayback(playingA, { id: 'B', source: 'library' });
  const wrapped = moveLibraryContinuation(playingB, ['A'], 'C', 'all');
  expect(getLibraryContinuation(wrapped, 'all')).toEqual(['A', 'C', 'B']);
  expect(wrapped.libraryFileId).toBe('B');
  expect(moveLibraryContinuation(playingB, ['A'], 'C', 'off').sequence.playOrderIds).toEqual(['A', 'B', 'C']);
});

test('returning promoted items restores their chosen position in a wrapped continuation', async () => {
  const { moveLibraryContinuation } = await import('./playbackSession');
  const playingB = acceptPlayback(playingA, { id: 'B', source: 'library' });
  const promoted = removeLibraryContinuation(playingB, ['A', 'C']);
  const restored = moveLibraryContinuation(promoted, ['A', 'C'], null, 'all', true);
  expect(getLibraryContinuation(restored, 'all')).toEqual(['A', 'C', 'B']);
  expect(getPlaybackTarget(restored, [], 'B', 'next', 'all')?.id).toBe('A');
  expect(restored.sequence.baseIds).toEqual(['A', 'B', 'C']);
  expect(restored.libraryFileId).toBe('B');
});

test('returning a previously played queued item does not duplicate its old position', async () => {
  const { moveLibraryContinuation } = await import('./playbackSession');
  const playingB = acceptPlayback(playingA, { id: 'B', source: 'library' });
  const restored = moveLibraryContinuation(playingB, ['A'], 'C', 'off', true);
  expect(restored.sequence.playOrderIds).toEqual(['B', 'A', 'C']);
  expect(getPlaybackTarget(acceptPlayback(restored, { id: 'A', source: 'library' }), [], 'A', 'next', 'off')?.id).toBe('C');
});
