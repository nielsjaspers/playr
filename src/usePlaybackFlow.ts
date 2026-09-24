import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';

import type { ICloudAudioFile } from '../modules/playr-icloud';
import { createPlaybackRequests, type PlaybackRequest } from './playbackIntent';
import { createPlaybackOrder, createPlaybackSequence, cycleRepeatMode, type PlaybackSequence, type RepeatMode } from './playbackSequence';
import { acceptPlayback, emptyPlaybackSession, getLibraryContinuation, getPlaybackTarget, type PlaybackSession, type PlaybackTarget } from './playbackSession';
import { orderFiles, parentFolderPath } from './libraryOrganization';
import type { usePlayback } from './usePlayback';
import type { usePlayrLibrary } from './usePlayrLibrary';

type Library = ReturnType<typeof usePlayrLibrary>;
type Playback = ReturnType<typeof usePlayback>;

export function usePlaybackFlow(library: Library, playback: Playback, onError: (message: string) => void) {
  const [session, setSession] = useState(emptyPlaybackSession);
  const sessionRef = useRef(session);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const repeatRef = useRef(repeatMode);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const shuffleRef = useRef(false);
  const [pending, setPending] = useState<PlaybackTarget | null>(null);
  const pendingRef = useRef(pending);
  const requests = useRef(createPlaybackRequests());
  const libraryRef = useRef(library);
  const playbackRef = useRef(playback);
  libraryRef.current = library;
  playbackRef.current = playback;

  useEffect(() => {
    library.protectDownloads([playback.currentFile?.id, pending?.id].filter((id): id is string => id != null));
  }, [library.protectDownloads, playback.currentFile?.id, pending?.id]);

  const updateSession = useCallback((next: PlaybackSession) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const cancelPending = useCallback(() => {
    requests.current.cancel();
    pendingRef.current = null;
    setPending(null);
  }, []);
  useEffect(() => () => requests.current.cancel(), []);

  const sequenceForFile = useCallback((file: ICloudAudioFile) => {
    const current = libraryRef.current;
    const parent = parentFolderPath(file.relativePath);
    const files = orderFiles(current.files.filter((item) => parentFolderPath(item.relativePath) === parent),
      parent, current.orderByFolder, current.reversedFolderPaths.has(parent));
    return createPlaybackSequence(files.map((item) => item.id), parent, file.id, shuffleRef.current);
  }, []);

  const startPrepared = useCallback(async (
    target: PlaybackTarget,
    request: PlaybackRequest,
    sequence?: PlaybackSequence,
  ) => {
    try {
      const file = await libraryRef.current.prepareFile(target.id);
      if (!request.isCurrent()) return false;
      const started = await playbackRef.current.play(file, {
        isCurrent: request.isCurrent,
        rememberTimestamp: libraryRef.current.folderPreferencesByPath.get(parentFolderPath(file.relativePath))?.rememberTimestamps ?? true,
      });
      if (!started || !request.isCurrent()) return false;
      updateSession(acceptPlayback(sessionRef.current, target, sequence));
      if (target.source === 'queue') {
        // Consume only after playback starts. Failed or canceled preparations remain queued.
        void libraryRef.current.removeFromQueue(target.id).catch((error: unknown) => {
          onError(error instanceof Error ? error.message : 'The queue could not be saved.');
        });
      }
      return true;
    } catch (error) {
      if (request.isCurrent()) onError(error instanceof Error ? error.message : 'The file could not play.');
      return false;
    } finally {
      if (request.isCurrent()) {
        pendingRef.current = null;
        setPending(null);
      }
    }
  }, [onError, updateSession]);

  const select = useCallback(async (
    target: PlaybackTarget,
    sequence?: PlaybackSequence,
    prompt = false,
  ) => {
    const request = requests.current.begin();
    pendingRef.current = target;
    setPending(target);
    if (prompt) {
      try {
        const file = await libraryRef.current.verifyFile(target.id);
        if (!request.isCurrent()) return false;
        if (!file) throw new Error('This file is no longer in the Playr iCloud folder.');
        if (file.downloadState === 'inCloud' && !libraryRef.current.autoDownloadOnTap) {
          const accepted = await new Promise<boolean>((resolve) => {
            const finish = (accepted: boolean) => {
              request.signal.removeEventListener('abort', abort);
              resolve(accepted);
            };
            const abort = () => finish(false);
            request.signal.addEventListener('abort', abort, { once: true });
            Alert.alert('Download from iCloud?', `Download "${file.name}" and start playback?`, [
              { text: 'Cancel', style: 'cancel', onPress: () => finish(false) },
              { text: 'Download and Play', onPress: () => finish(true) },
              { text: 'Always Download', onPress: () => {
                if (request.isCurrent()) void libraryRef.current.setAutoDownloadOnTap(true).catch((error: unknown) => {
                  onError(error instanceof Error ? error.message : 'The preference could not be saved.');
                });
                finish(true);
              } },
            ], { cancelable: true, onDismiss: () => finish(false) });
          });
          if (!accepted || !request.isCurrent()) {
            if (request.isCurrent()) cancelPending();
            return false;
          }
        }
      } catch (error) {
        if (request.isCurrent()) {
          onError(error instanceof Error ? error.message : 'The file could not open.');
          cancelPending();
        }
        return false;
      }
    }
    return startPrepared(target, request, sequence);
  }, [cancelPending, onError, startPrepared]);

  const openLibraryFile = useCallback((file: ICloudAudioFile) => {
    if (file.id === playbackRef.current.currentFile?.id && sessionRef.current.currentSource === 'library') {
      cancelPending();
      void playbackRef.current.toggle();
      return;
    }
    void select({ id: file.id, source: 'library' }, sequenceForFile(file), true);
  }, [cancelPending, select, sequenceForFile]);

  const playFolder = useCallback((folderPath: string, files: ICloudAudioFile[]) => {
    const sequence = createPlaybackSequence(files.map((file) => file.id), folderPath, null, shuffleRef.current);
    const id = sequence.playOrderIds[0];
    if (id) void select({ id, source: 'library' }, sequence);
  }, [select]);

  const navigate = useCallback(async (direction: 'next' | 'previous' | 'finished') => {
    if (direction === 'finished' && pendingRef.current) return false;
    const currentId = playbackRef.current.currentFile?.id ?? null;
    const current = sessionRef.current;
    const available = new Set(libraryRef.current.files.map((file) => file.id));
    const navigable = { ...current, sequence: current.sequence == null ? null : { ...current.sequence,
      playOrderIds: current.sequence.playOrderIds.filter((id) => id === current.libraryFileId || available.has(id)),
    } };
    const target = getPlaybackTarget(navigable, libraryRef.current.getQueueIds().filter((id) => available.has(id)), currentId, direction, repeatRef.current);
    if (!target) { cancelPending(); return false; }
    if (direction === 'finished' && repeatRef.current === 'one') {
      await playbackRef.current.replay();
      return true;
    }
    return select(target);
  }, [cancelPending, select]);

  const toggle = useCallback(() => {
    cancelPending();
    void playbackRef.current.toggle();
  }, [cancelPending]);

  const stop = useCallback(async () => {
    cancelPending();
    if (!await playbackRef.current.stop()) throw new Error('The player could not release this file. Try stopping playback again.');
  }, [cancelPending]);

  const toggleShuffle = useCallback(() => {
    shuffleRef.current = !shuffleRef.current;
    setShuffleEnabled(shuffleRef.current);
    const current = sessionRef.current;
    if (current.sequence) updateSession({ ...current, sequence: {
      ...current.sequence,
      playOrderIds: createPlaybackOrder(current.sequence.baseIds, current.libraryFileId, shuffleRef.current),
    } });
  }, [updateSession]);

  const advanceRepeatMode = useCallback(() => {
    repeatRef.current = cycleRepeatMode(repeatRef.current);
    setRepeatMode(repeatRef.current);
  }, []);

  const remapPath = useCallback((oldPath: string, newPath: string) => {
    cancelPending();
    const remap = (path: string) => path === oldPath || path.startsWith(`${oldPath}/`)
      ? `${newPath}${path.slice(oldPath.length)}` : path;
    const current = sessionRef.current;
    updateSession({ ...current,
      libraryFileId: current.libraryFileId == null ? null : remap(current.libraryFileId),
      sequence: current.sequence == null ? null : {
        sourcePath: remap(current.sequence.sourcePath),
        baseIds: current.sequence.baseIds.map(remap),
        playOrderIds: current.sequence.playOrderIds.map(remap),
      },
    });
  }, [cancelPending, updateSession]);

  const continuationIds = useMemo(() => getLibraryContinuation(session, repeatMode), [session, repeatMode]);
  const reorderContinuation = useCallback((ids: string[]) => {
    const current = sessionRef.current;
    if (!current.sequence) return;
    const remaining = new Set(ids);
    updateSession({ ...current, sequence: { ...current.sequence,
      playOrderIds: [...current.sequence.playOrderIds.filter((id) => !remaining.has(id)), ...ids],
    } });
  }, [updateSession]);

  // Queue edits can cancel an item that is still being prepared for playback.
  useEffect(() => {
    if (pendingRef.current?.source === 'queue' && !library.queueIds.includes(pendingRef.current.id)) cancelPending();
  }, [cancelPending, library.queueIds]);

  const next = getPlaybackTarget(session, library.queueIds, playback.currentFile?.id ?? null, 'finished', repeatMode);
  useEffect(() => {
    if (!next || next.id === playbackRef.current.currentFile?.id || pendingRef.current) return;
    const file = libraryRef.current.files.find((item) => item.id === next.id);
    if (file?.downloadState === 'inCloud') {
      void libraryRef.current.prepareFile(next.id).catch((error: unknown) => console.warn('Next item could not be prefetched', error));
    }
  }, [next?.id]);

  return {
    session, repeatMode, shuffleEnabled, pending, continuationIds,
    openLibraryFile, playFolder, navigate, toggle, stop, cancelPending, toggleShuffle, advanceRepeatMode,
    openQueueFile: (id: string) => select({ id, source: 'queue' }),
    openContinuation: (id: string) => select({ id, source: 'library' }),
    reorderContinuation, remapPath,
  };
}
