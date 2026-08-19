import { describe, expect, test } from 'bun:test';

import { getEpisodePressIntent } from './playbackIntent';

describe('getEpisodePressIntent', () => {
  test('toggles the current episode instead of starting it again', () => {
    expect(getEpisodePressIntent('episode-68', 'episode-68')).toBe('toggle');
  });

  test('opens another episode', () => {
    expect(getEpisodePressIntent('episode-69', 'episode-68')).toBe('open');
  });
});
