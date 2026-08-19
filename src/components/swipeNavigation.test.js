import { describe, expect, test } from 'bun:test';

import { getHorizontalSwipeDirection } from './swipeNavigation';

describe('horizontal playback navigation', () => {
  test('recognizes both playback directions', () => {
    expect(getHorizontalSwipeDirection(-80, 8)).toBe('next');
    expect(getHorizontalSwipeDirection(80, -8)).toBe('previous');
    expect(getHorizontalSwipeDirection(-36, 20)).toBe('next');
    expect(getHorizontalSwipeDirection(36, -20)).toBe('previous');
    expect(getHorizontalSwipeDirection(-18, 2, -0.6)).toBe('next');
    expect(getHorizontalSwipeDirection(18, -2, 0.6)).toBe('previous');
    expect(getHorizontalSwipeDirection(-18, 10)).toBe('next');
    expect(getHorizontalSwipeDirection(18, -10)).toBe('previous');
    expect(getHorizontalSwipeDirection(-8, 3, -0.18)).toBe('next');
    expect(getHorizontalSwipeDirection(8, -3, 0.18)).toBe('previous');
  });

  test('rejects short and mostly vertical gestures', () => {
    expect(getHorizontalSwipeDirection(5, 2)).toBeNull();
    expect(getHorizontalSwipeDirection(80, 120)).toBeNull();
    expect(getHorizontalSwipeDirection(18, 40, 0.6)).toBeNull();
  });
});
