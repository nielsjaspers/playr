import { describe, expect, test } from 'bun:test';

import {
  createPlaybackOrder,
  cycleRepeatMode,
  getAdjacentPlaybackId,
  getCompletionTarget,
} from './playbackSequence';

describe('playback sequence', () => {
  test('plays the next item without wrapping when repeat is off', () => {
    expect(getCompletionTarget(['one', 'two'], 'one', 'off')).toBe('two');
    expect(getCompletionTarget(['one', 'two'], 'two', 'off')).toBeNull();
  });

  test('loops the sequence or the current item', () => {
    expect(getCompletionTarget(['one', 'two'], 'two', 'all')).toBe('one');
    expect(getCompletionTarget(['one', 'two'], 'two', 'one')).toBe('two');
  });

  test('manual previous and next navigation can wrap', () => {
    expect(getAdjacentPlaybackId(['one', 'two'], 'one', 'previous', true)).toBe('two');
    expect(getAdjacentPlaybackId(['one', 'two'], 'two', 'next', false)).toBeNull();
  });

  test('shuffle keeps the selected item first and randomizes the rest', () => {
    const values = [0, 0];
    expect(createPlaybackOrder(['one', 'two', 'three'], 'two', true, () => values.shift() ?? 0))
      .toEqual(['two', 'three', 'one']);
  });

  test('cycles through off, all, and one', () => {
    expect(cycleRepeatMode('off')).toBe('all');
    expect(cycleRepeatMode('all')).toBe('one');
    expect(cycleRepeatMode('one')).toBe('off');
  });
});
