import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import PlayrICloud, {
  type ICloudAudioFile,
  type ICloudAvailability,
} from '../modules/playr-icloud';
import {
  addToQueue as persistQueueItem,
  clearQueue as persistQueueClear,
  getCachedLibrary,
  getOverdueCompletedIds,
  getPlaybackProgress,
  getQueueIds,
  removeFromQueue as persistQueueRemoval,
  replaceLibraryCache,
  savePlaybackProgress,
  type PlaybackProgress,
} from './storage';

const COMPLETED_DOWNLOAD_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const DOWNLOAD_POLL_INTERVAL_MS = 1_000;
const DOWNLOAD_POLL_LIMIT = 120;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function replaceFiles(current: ICloudAudioFile[], replacements: ICloudAudioFile[]) {
  const byId = new Map(replacements.map((file) => [file.id, file]));
  return current.map((file) => byId.get(file.id) ?? file);
}

export function usePlayrLibrary() {
  const [files, setFiles] = useState<ICloudAudioFile[]>([]);
  const [progressById, setProgressById] = useState<Map<string, PlaybackProgress>>(new Map());
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [availability, setAvailability] = useState<ICloudAvailability>('available');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filesRef = useRef(files);
  const hasInitialized = useRef(false);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const applyFiles = useCallback((nextFiles: ICloudAudioFile[]) => {
    filesRef.current = nextFiles;
    setFiles(nextFiles);
  }, []);

  const removeOverdueDownloads = useCallback(
    async (currentFiles: ICloudAudioFile[]) => {
      const cutoff = Date.now() - COMPLETED_DOWNLOAD_RETENTION_MS;
      const overdueIds = await getOverdueCompletedIds(cutoff);
      if (overdueIds.length === 0) return currentFiles;

      const overdueSet = new Set(overdueIds);
      const removableIds = currentFiles
        .filter(
          (file) =>
            overdueSet.has(file.id) &&
            file.downloadState === 'downloaded' &&
            file.isUploaded,
        )
        .map((file) => file.id);

      // Files already evicted by iOS are intentionally skipped.
      if (removableIds.length === 0) return currentFiles;

      const results = await PlayrICloud.removeDownloadsAsync(removableIds);
      const removedIds = new Set(
        results.filter((result) => result.succeeded).map((result) => result.id),
      );
      return currentFiles.map((file) =>
        removedIds.has(file.id)
          ? { ...file, downloadState: 'inCloud' as const, downloadProgress: null, localUri: null }
          : file,
      );
    },
    [],
  );

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const nextAvailability = await PlayrICloud.getAvailabilityAsync();
      setAvailability(nextAvailability);
      if (nextAvailability !== 'available') return;

      await PlayrICloud.ensureLibraryAsync();
      const listedFiles = await PlayrICloud.listAudioFilesAsync();
      const cleanedFiles = await removeOverdueDownloads(listedFiles);
      applyFiles(cleanedFiles);
      await replaceLibraryCache(cleanedFiles);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'The library could not refresh.');
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
    }
  }, [applyFiles, removeOverdueDownloads]);

  useEffect(() => {
    let isMounted = true;

    async function initialize() {
      const [cachedFiles, storedProgress, storedQueue] = await Promise.all([
        getCachedLibrary(),
        getPlaybackProgress(),
        getQueueIds(),
      ]);
      if (!isMounted) return;

      applyFiles(cachedFiles);
      setProgressById(storedProgress);
      setQueueIds(storedQueue);
      hasInitialized.current = true;
      await refresh();
    }

    initialize().catch((caughtError: unknown) => {
      if (!isMounted) return;
      setError(caughtError instanceof Error ? caughtError.message : 'Playr could not start.');
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [applyFiles, refresh]);

  useEffect(() => {
    let previousState: AppStateStatus = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (hasInitialized.current && previousState !== 'active' && nextState === 'active') {
        void refresh();
      }
      previousState = nextState;
    });
    return () => subscription.remove();
  }, [refresh]);

  const download = useCallback(async (ids: string[]) => {
    const cloudIds = ids.filter(
      (id) => filesRef.current.find((file) => file.id === id)?.downloadState === 'inCloud',
    );
    if (cloudIds.length === 0) return [];

    const results = await PlayrICloud.requestDownloadsAsync(cloudIds);
    const startedIds = results.filter((result) => result.succeeded).map((result) => result.id);
    const failure = results.find((result) => !result.succeeded);
    if (failure) setError(failure.error ?? 'A download could not start.');
    if (startedIds.length === 0) return [];

    const startedSet = new Set(startedIds);
    applyFiles(
      filesRef.current.map((file) =>
        startedSet.has(file.id) ? { ...file, downloadState: 'downloading' } : file,
      ),
    );

    let pendingIds = startedIds;
    const downloadedFiles: ICloudAudioFile[] = [];
    for (let attempt = 0; attempt < DOWNLOAD_POLL_LIMIT && pendingIds.length > 0; attempt += 1) {
      await wait(DOWNLOAD_POLL_INTERVAL_MS);
      const updatedFiles = await PlayrICloud.getAudioFilesAsync(pendingIds);
      applyFiles(replaceFiles(filesRef.current, updatedFiles));
      downloadedFiles.push(
        ...updatedFiles.filter((file) => file.downloadState === 'downloaded'),
      );
      const downloadedIds = new Set(downloadedFiles.map((file) => file.id));
      pendingIds = pendingIds.filter((id) => !downloadedIds.has(id));
    }

    await replaceLibraryCache(filesRef.current);
    if (pendingIds.length > 0) {
      setError('The iCloud download is taking longer than expected. It can continue in the background.');
    }
    return downloadedFiles;
  }, [applyFiles]);

  const verifyFile = useCallback(async (id: string) => {
    const [verifiedFile] = await PlayrICloud.getAudioFilesAsync([id]);
    if (!verifiedFile) return null;
    const nextFiles = replaceFiles(filesRef.current, [verifiedFile]);
    applyFiles(nextFiles);
    void replaceLibraryCache(nextFiles);
    return verifiedFile;
  }, [applyFiles]);

  const removeDownloads = useCallback(async (ids: string[]) => {
    const results = await PlayrICloud.removeDownloadsAsync(ids);
    const removedIds = new Set(
      results.filter((result) => result.succeeded).map((result) => result.id),
    );
    const nextFiles = filesRef.current.map((file) =>
      removedIds.has(file.id)
        ? { ...file, downloadState: 'inCloud' as const, downloadProgress: null, localUri: null }
        : file,
    );
    applyFiles(nextFiles);
    await replaceLibraryCache(nextFiles);

    const failure = results.find((result) => !result.succeeded);
    if (failure) setError(failure.error ?? 'A local download could not be removed.');
    return [...removedIds];
  }, [applyFiles]);

  const updateProgress = useCallback(async (nextProgress: PlaybackProgress) => {
    setProgressById((current) => new Map(current).set(nextProgress.fileId, nextProgress));
    await savePlaybackProgress(nextProgress);
  }, []);

  const addToQueue = useCallback(async (fileId: string) => {
    if (queueIds.includes(fileId)) return;
    setQueueIds((current) => [...current, fileId]);
    await persistQueueItem(fileId);
  }, [queueIds]);

  const removeFromQueue = useCallback(async (fileId: string) => {
    setQueueIds((current) => current.filter((id) => id !== fileId));
    await persistQueueRemoval(fileId);
  }, []);

  const clearQueue = useCallback(async () => {
    setQueueIds([]);
    await persistQueueClear();
  }, []);

  return {
    files,
    progressById,
    queueIds,
    availability,
    isLoading,
    isRefreshing,
    error,
    clearError: () => setError(null),
    refresh,
    verifyFile,
    download,
    removeDownloads,
    updateProgress,
    addToQueue,
    removeFromQueue,
    clearQueue,
  };
}
