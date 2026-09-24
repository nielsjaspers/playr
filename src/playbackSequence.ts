export type RepeatMode = 'off' | 'all' | 'one';

export type PlaybackSequence = {
  sourcePath: string;
  baseIds: string[];
  playOrderIds: string[];
};

export function createPlaybackOrder(
  ids: string[],
  currentId: string | null,
  shuffle: boolean,
  random: () => number = Math.random,
) {
  if (!shuffle) return [...ids];

  const remaining = currentId == null ? [...ids] : ids.filter((id) => id !== currentId);
  for (let index = remaining.length - 1; index > 0; index -= 1) {
    const targetIndex = Math.floor(random() * (index + 1));
    [remaining[index], remaining[targetIndex]] = [remaining[targetIndex], remaining[index]];
  }
  return currentId != null && ids.includes(currentId) ? [currentId, ...remaining] : remaining;
}

export function createPlaybackSequence(
  ids: string[],
  sourcePath: string,
  currentId: string | null,
  shuffle: boolean,
): PlaybackSequence {
  return {
    sourcePath,
    baseIds: [...ids],
    playOrderIds: createPlaybackOrder(ids, currentId, shuffle),
  };
}

export function getAdjacentPlaybackId(
  ids: string[],
  currentId: string,
  direction: 'next' | 'previous',
  wrap: boolean,
) {
  if (ids.length === 0) return null;
  const currentIndex = ids.indexOf(currentId);
  if (currentIndex < 0) return direction === 'next' ? ids[0] : ids.at(-1) ?? null;

  const offset = direction === 'next' ? 1 : -1;
  const nextIndex = currentIndex + offset;
  if (nextIndex >= 0 && nextIndex < ids.length) return ids[nextIndex];
  if (!wrap) return null;
  return direction === 'next' ? ids[0] : ids.at(-1) ?? null;
}

export function cycleRepeatMode(current: RepeatMode): RepeatMode {
  if (current === 'off') return 'all';
  if (current === 'all') return 'one';
  return 'off';
}
