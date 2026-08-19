import { describe, expect, test } from 'bun:test';

import { formatRemovalFailure, removeDownloadsWithLockRetry } from './removal';

describe('removeDownloadsWithLockRetry', () => {
  test('retries a locked file until iCloud releases it', async () => {
    const calls = [];
    const updates = [];
    const remove = async (ids) => {
      calls.push(ids);
      if (calls.length < 3) {
        return [
          { id: 'playing', succeeded: false, error: 'The file couldn\'t be locked.' },
          ...(calls.length === 1
            ? [{ id: 'other', succeeded: true, error: null }]
            : []),
        ];
      }
      return [{ id: 'playing', succeeded: true, error: null }];
    };

    const results = await removeDownloadsWithLockRetry(
      ['playing', 'other'],
      remove,
      {
        waitForRetry: async () => {},
        onRetry: (update) => updates.push(update),
      },
    );

    expect(calls).toEqual([['playing', 'other'], ['playing'], ['playing']]);
    expect(results).toEqual([
      { id: 'playing', succeeded: true, error: null },
      { id: 'other', succeeded: true, error: null },
    ]);
    expect(updates).toEqual([
      { attempt: 1, maximumAttempts: 3, delayMilliseconds: 250 },
      { attempt: 2, maximumAttempts: 3, delayMilliseconds: 750 },
    ]);
  });

  test('does not hide a non-locking failure', async () => {
    const results = await removeDownloadsWithLockRetry(
      ['uploading'],
      async () => [
        {
          id: 'uploading',
          succeeded: false,
          error: 'The file has not finished uploading to iCloud.',
        },
      ],
      { waitForRetry: async () => {} },
    );

    expect(results[0]?.succeeded).toBe(false);
  });
});

describe('formatRemovalFailure', () => {
  test('turns the raw file-lock error into useful copy', () => {
    expect(formatRemovalFailure('The file couldn\'t be locked.')).toBe(
      'Close the file in Files, then try again. The audio file is still downloaded.',
    );
  });
});
