import { describe, expect, test } from 'bun:test';

import { releaseAudioPlayer } from './audioPlayerLifecycle';

describe('releaseAudioPlayer', () => {
  test('destroys the native player instead of only replacing its source', () => {
    const calls = [];
    const player = {
      pause: () => calls.push('pause'),
      clearLockScreenControls: () => calls.push('clearLockScreenControls'),
      replace: (source) => calls.push(['replace', source]),
      release: () => calls.push('release'),
    };

    releaseAudioPlayer(player);

    expect(calls).toEqual([
      'pause',
      'clearLockScreenControls',
      ['replace', null],
      'release',
    ]);
  });
});
