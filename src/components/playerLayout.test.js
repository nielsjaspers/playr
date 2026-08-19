import { describe, expect, test } from 'bun:test';

import { getPlayerLayout } from './playerLayout';

describe('getPlayerLayout', () => {
  test('keeps artwork from crowding controls on a compact player sheet', () => {
    const viewportHeight = 759;
    const layout = getPlayerLayout(393, viewportHeight);

    expect(layout.artworkSize).toBeLessThanOrEqual(viewportHeight * 0.34);
  });
});
