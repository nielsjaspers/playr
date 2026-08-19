import type { PlaybackProgress } from './storage';

type ProgressSnapshot = Pick<PlaybackProgress, 'position' | 'duration' | 'completedAt'>;

export type FinishGate = {
  fileId: string;
  armed: boolean;
  handled: boolean;
};

type FinishStatus = {
  currentTime: number;
  didJustFinish: boolean;
  duration: number;
  isLoaded: boolean;
};

export function createFinishGate(fileId: string): FinishGate {
  return { fileId, armed: false, handled: false };
}

/** Arms only after the replacement source reports a non-finished state. */
export function advanceFinishGate(gate: FinishGate, status: FinishStatus) {
  if (!gate.armed) {
    const isReady = status.isLoaded && !status.didJustFinish;
    return {
      gate: isReady ? { ...gate, armed: true } : gate,
      shouldFinish: false,
    };
  }

  if (!status.didJustFinish || gate.handled) {
    return { gate, shouldFinish: false };
  }

  return {
    gate: { ...gate, handled: true },
    shouldFinish: true,
  };
}

export function resolveResumePosition(
  progress: ProgressSnapshot | undefined,
  rememberTimestamp: boolean,
) {
  if (!rememberTimestamp || progress?.completedAt != null) return 0;
  return Math.max(0, Math.min(progress?.position ?? 0, progress?.duration ?? 0));
}

export function cloudPlaybackBehavior(
  trigger: 'direct' | 'automatic',
  skipDirectPrompt: boolean,
) {
  if (trigger === 'automatic') return 'downloadForNext' as const;
  return skipDirectPrompt ? 'downloadAndPlay' as const : 'prompt' as const;
}
