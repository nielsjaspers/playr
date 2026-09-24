import { describe, expect, test } from 'bun:test';

import {
  advanceFinishGate,
  createFinishGate,
  resolveResumePosition,
} from './playbackPolicy';

describe('playback policy', () => {
  test('does not finish newly replaced audio from the previous item stale finish event', () => {
    let gate = createFinishGate('two');

    const staleFinish = advanceFinishGate(gate, {
      currentTime: 0,
      didJustFinish: true,
      duration: 120,
      isLoaded: true,
    });
    expect(staleFinish.shouldFinish).toBe(false);
    gate = staleFinish.gate;

    gate = advanceFinishGate(gate, {
      currentTime: 0,
      didJustFinish: false,
      duration: 120,
      isLoaded: true,
    }).gate;

    const realFinish = advanceFinishGate(gate, {
      currentTime: 120,
      didJustFinish: true,
      duration: 120,
      isLoaded: true,
    });
    expect(realFinish.shouldFinish).toBe(true);
    expect(advanceFinishGate(realFinish.gate, {
      currentTime: 120,
      didJustFinish: true,
      duration: 120,
      isLoaded: true,
    }).shouldFinish).toBe(false);
  });

  test('resumes only unfinished audio in folders that remember timestamps', () => {
    const unfinished = { position: 42, duration: 100, completedAt: null };
    const finished = { position: 100, duration: 100, completedAt: 1 };

    expect(resolveResumePosition(unfinished, true)).toBe(42);
    expect(resolveResumePosition(unfinished, false)).toBe(0);
    expect(resolveResumePosition(finished, true)).toBe(0);
  });

});
