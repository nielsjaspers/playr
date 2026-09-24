import { expect, test } from 'bun:test';
import { createProgressCheckpoint } from './progressCheckpoint';

test('checkpoints continue on elapsed time after a seek or a paused interval', () => {
  let now = 0;
  const checkpoint = createProgressCheckpoint(() => now);
  now = 5000;
  expect(checkpoint.isDue()).toBe(true);
  checkpoint.saved();
  // The seek saves its new position immediately, regardless of media time.
  now = 6000;
  checkpoint.saved();
  now = 10999;
  expect(checkpoint.isDue()).toBe(false);
  now = 11000;
  expect(checkpoint.isDue()).toBe(true);
});
