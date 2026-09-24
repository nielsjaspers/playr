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
    ? [...order.slice(index + 1), ...order.slice(0, index)]
    : order.slice(index + 1);
}
