import { moveItemsBefore } from './queueOrder';
import { getAdjacentPlaybackId, type PlaybackSequence, type RepeatMode } from './playbackSequence';

export type PlaybackSource = 'library' | 'queue';
export type PlaybackTarget = { id: string; source: PlaybackSource };
export type PlaybackSession = {
  sequence: PlaybackSequence | null;
  libraryFileId: string | null;
  currentSource: PlaybackSource;
};

export const emptyPlaybackSession: PlaybackSession = {
  sequence: null,
  libraryFileId: null,
  currentSource: 'library',
};

/** Queued items temporarily interrupt the library cursor. They never move it. */
export function acceptPlayback(
  session: PlaybackSession,
  target: PlaybackTarget,
  sequence = session.sequence,
): PlaybackSession {
  return {
    sequence,
    libraryFileId: target.source === 'library' ? target.id : session.libraryFileId,
    currentSource: target.source,
  };
}

export function getPlaybackTarget(
  session: PlaybackSession,
  queueIds: readonly string[],
  currentId: string | null,
  direction: 'next' | 'previous' | 'finished',
  repeat: RepeatMode,
): PlaybackTarget | null {
  if (direction === 'finished' && repeat === 'one' && currentId) {
    return { id: currentId, source: session.currentSource };
  }
  if (direction !== 'previous' && queueIds.length > 0) {
    return { id: queueIds[0], source: 'queue' };
  }
  const order = session.sequence?.playOrderIds ?? [];
  if (direction === 'previous' && session.currentSource === 'queue' && session.libraryFileId) {
    return { id: session.libraryFileId, source: 'library' };
  }
  const id = session.libraryFileId == null
    ? direction === 'previous' ? null : order[0]
    : getAdjacentPlaybackId(order, session.libraryFileId, direction === 'previous' ? 'previous' : 'next', repeat === 'all');
  return id ? { id, source: 'library' } : null;
}

/** Shows the remaining library order once; repeat does not duplicate rows. */
export function getLibraryContinuation(session: PlaybackSession, repeat: RepeatMode) {
  const order = session.sequence?.playOrderIds ?? [];
  const index = session.libraryFileId == null ? -1 : order.indexOf(session.libraryFileId);
  return repeat === 'all' && index >= 0
    ? [...order.slice(index + 1), ...order.slice(0, index + 1)]
    : order.slice(index + 1);
}

/** Rearrange the remaining session order while retaining the current library cursor. */
export function moveLibraryContinuation(
  session: PlaybackSession, ids: string[], beforeId: string | null, repeat: RepeatMode,
  allowNewItems = false,
): PlaybackSession {
  if (!session.sequence) return session;
  const upcoming = getLibraryContinuation(session, repeat).filter((id) => id !== session.libraryFileId);
  const reordered = moveItemsBefore(upcoming, ids.filter((id) => id !== session.libraryFileId),
    beforeId === session.libraryFileId ? null : beforeId, allowNewItems);
  const originalOrder = session.sequence.playOrderIds;
  const cursorIndex = session.libraryFileId == null ? -1 : originalOrder.indexOf(session.libraryFileId);
  // Retain the played prefix, except episodes moved back into the upcoming order.
  const upcomingIds = new Set(reordered);
  const playedPrefix = originalOrder.slice(0, cursorIndex + 1).filter((id) => !upcomingIds.has(id));
  const afterCursorCount = originalOrder.length - cursorIndex - 1 + reordered.length - upcoming.length;
  const order = repeat === 'all' && cursorIndex >= 0
    ? [...reordered.slice(afterCursorCount), originalOrder[cursorIndex], ...reordered.slice(0, afterCursorCount)]
    : [...playedPrefix, ...reordered];
  return { ...session, sequence: { ...session.sequence, playOrderIds: order } };
}

/** Promoted episodes leave this session's continuation, not the saved folder order. */
export function removeLibraryContinuation(session: PlaybackSession, ids: string[]) {
  if (!session.sequence) return session;
  const removed = new Set(ids.filter((id) => id !== session.libraryFileId));
  return { ...session, sequence: { ...session.sequence,
    playOrderIds: session.sequence.playOrderIds.filter((id) => !removed.has(id)),
  } };
}
