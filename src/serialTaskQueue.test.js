import { describe, expect, test } from 'bun:test';

import { createSerialTaskQueue } from './serialTaskQueue';

describe('serial task queue', () => {
  test('does not overlap storage writes that start together', async () => {
    const queue = createSerialTaskQueue();
    const events = [];
    let releaseFirst;
    const firstCanFinish = new Promise((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.run(async () => {
      events.push('first:start');
      await firstCanFinish;
      events.push('first:end');
    });
    const second = queue.run(async () => {
      events.push('second:start');
      events.push('second:end');
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  test('continues after a failed write', async () => {
    const queue = createSerialTaskQueue();
    await expect(queue.run(async () => {
      throw new Error('locked');
    })).rejects.toThrow('locked');
    await expect(queue.run(async () => 'saved')).resolves.toBe('saved');
  });
});
