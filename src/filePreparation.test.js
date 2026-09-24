import { expect, test } from 'bun:test';
import { createFilePreparation } from './filePreparation';

test('a prefetch and a playback request share one transfer and verification loop', async () => {
  const tick = Promise.withResolvers();
  let ready = false;
  let requests = 0;
  const prepare = createFilePreparation({
    verify: async (id) => ({ id, metadataAvailable: true, downloadState: ready ? 'downloaded' : 'inCloud', localUri: ready ? 'file://audio' : null }),
    request: async () => { requests += 1; },
    wait: () => tick.promise,
  });
  const prefetched = prepare('audio');
  const selected = prepare('audio');
  expect(prefetched).toBe(selected);
  await Promise.resolve();
  ready = true;
  tick.resolve();
  expect((await selected).localUri).toBe('file://audio');
  expect(requests).toBe(1);
});

test('a failed request can be retried and unavailable metadata does not authorize playback', async () => {
  let fails = true;
  let verified = false;
  const prepare = createFilePreparation({
    verify: async (id) => {
      if (fails) throw new Error('Metadata unavailable');
      return { id, metadataAvailable: verified, downloadState: 'downloaded', localUri: 'file://audio' };
    },
    request: async () => { throw new Error('Unexpected transfer'); },
    wait: async () => { verified = true; },
  });
  await expect(prepare('audio')).rejects.toThrow('Metadata unavailable');
  fails = false;
  expect((await prepare('audio')).metadataAvailable).toBe(true);
});
