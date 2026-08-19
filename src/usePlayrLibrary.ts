import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import PlayrICloud, {
  type ICloudAudioFile,
  type ICloudAvailability,
  type ICloudFolder,
} from '../modules/playr-icloud';
import { mergeListedFiles, replaceVerifiedFiles } from './libraryFiles';
import {
  buildItemsByParent,
  parentFolderPath,
  reconcileLibraryOrder,
  remapLibraryOrderPaths,
  reorderFolderFiles,
  type LibraryOrder,
} from './libraryOrganization';
import { formatRemovalFailure, removeDownloadsWithLockRetry } from './removal';
import {
  addToQueue as persistQueueItem,
  clearQueue as persistQueueClear,
  getCachedLibrary,
  getAutoDownloadOnTap,
  getFolderPreferences,
  getLibraryOrder,
  getOverdueCompletedIds,
  getPlaybackProgress,
  getQueueIds,
  getReversedFolderPaths,
  remapFolderPathPrefix,
  remapPlaybackFileId,
  removeFromQueue as persistQueueRemoval,
  replaceLibraryCache,
  replaceLibraryOrder,
  replaceQueue,
  replaceReversedFolderPaths,
  saveAutoDownloadOnTap,
  saveFolderKeepDownloads,
  saveFolderOrderReversed,
  saveFolderRememberTimestamps,
  savePlaybackProgress,
  type FolderPreferences,
  type PlaybackProgress,
} from './storage';

const COMPLETED_DOWNLOAD_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const DOWNLOAD_POLL_INTERVAL_MS = 1_000;
const DOWNLOAD_POLL_LIMIT = 120;

const DEFAULT_FOLDER_PREFERENCES: FolderPreferences = {
  keepDownloads: false,
  rememberTimestamps: true,
};

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export function usePlayrLibrary() {
  const [files, setFiles] = useState<ICloudAudioFile[]>([]);
  const [folders, setFolders] = useState<ICloudFolder[]>([]);
  const [orderByFolder, setOrderByFolder] = useState<LibraryOrder>(new Map());
  const [reversedFolderPaths, setReversedFolderPaths] = useState<Set<string>>(new Set());
  const [folderPreferencesByPath, setFolderPreferencesByPath] = useState<
    Map<string, FolderPreferences>
  >(new Map());
  const [autoDownloadOnTap, setAutoDownloadOnTapState] = useState(false);
  const [progressById, setProgressById] = useState<Map<string, PlaybackProgress>>(new Map());
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [availability, setAvailability] = useState<ICloudAvailability>('available');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const filesRef = useRef(files);
  const foldersRef = useRef(folders);
  const orderRef = useRef(orderByFolder);
  const folderPreferencesRef = useRef(folderPreferencesByPath);
  const hasInitialized = useRef(false);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    foldersRef.current = folders;
  }, [folders]);

  useEffect(() => {
    orderRef.current = orderByFolder;
  }, [orderByFolder]);

  useEffect(() => {
    folderPreferencesRef.current = folderPreferencesByPath;
  }, [folderPreferencesByPath]);

  const applyFiles = useCallback((nextFiles: ICloudAudioFile[]) => {
    filesRef.current = nextFiles;
    setFiles(nextFiles);
  }, []);

  const applyOrganization = useCallback(
    async (nextFiles: ICloudAudioFile[], nextFolders: ICloudFolder[]) => {
      const nextOrder = reconcileLibraryOrder(
        orderRef.current,
        buildItemsByParent(nextFiles, nextFolders),
      );
      foldersRef.current = nextFolders;
      orderRef.current = nextOrder;
      setFolders(nextFolders);
      setOrderByFolder(nextOrder);
      await replaceLibraryOrder(nextOrder);
    },
    [],
  );

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
            !folderPreferencesRef.current.get(parentFolderPath(file.relativePath))?.keepDownloads &&
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
      const [nativeFiles, nextFolders] = await Promise.all([
        PlayrICloud.listAudioFilesAsync(),
        PlayrICloud.listFoldersAsync(),
      ]);
      const listedFiles = mergeListedFiles(filesRef.current, nativeFiles);
      const cleanedFiles = await removeOverdueDownloads(listedFiles);
      applyFiles(cleanedFiles);
      await replaceLibraryCache(cleanedFiles);
      await applyOrganization(cleanedFiles, nextFolders);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'The library could not refresh.');
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
    }
  }, [applyFiles, applyOrganization, removeOverdueDownloads]);

  useEffect(() => {
    let isMounted = true;

    async function initialize() {
      const [
        cachedFiles,
        storedProgress,
        storedQueue,
        storedOrder,
        storedReversedPaths,
        storedFolderPreferences,
        storedAutoDownloadOnTap,
      ] = await Promise.all([
        getCachedLibrary(),
        getPlaybackProgress(),
        getQueueIds(),
        getLibraryOrder(),
        getReversedFolderPaths(),
        getFolderPreferences(),
        getAutoDownloadOnTap(),
      ]);
      if (!isMounted) return;

      applyFiles(cachedFiles);
      setProgressById(storedProgress);
      setQueueIds(storedQueue);
      orderRef.current = storedOrder;
      setOrderByFolder(storedOrder);
      setReversedFolderPaths(storedReversedPaths);
      folderPreferencesRef.current = storedFolderPreferences;
      setFolderPreferencesByPath(storedFolderPreferences);
      setAutoDownloadOnTapState(storedAutoDownloadOnTap);
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
      applyFiles(replaceVerifiedFiles(filesRef.current, updatedFiles));
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
    const nextFiles = replaceVerifiedFiles(filesRef.current, [verifiedFile]);
    applyFiles(nextFiles);
    void replaceLibraryCache(nextFiles);
    return verifiedFile;
  }, [applyFiles]);

  const removeDownloads = useCallback(async (ids: string[]) => {
    setError(null);
    setRemovingIds(new Set(ids));
    try {
      const results = await removeDownloadsWithLockRetry(
        ids,
        (retryIds) => PlayrICloud.removeDownloadsAsync(retryIds),
      );
      const verifiedFiles = await PlayrICloud.getAudioFilesAsync(ids);
      const nextFiles = replaceVerifiedFiles(filesRef.current, verifiedFiles);
      applyFiles(nextFiles);
      await replaceLibraryCache(nextFiles);

      const failure = results.find((result) => !result.succeeded);
      if (failure) setError(formatRemovalFailure(failure.error));
      return verifiedFiles
        .filter(
          (file) => file.metadataAvailable !== false && file.downloadState === 'inCloud',
        )
        .map((file) => file.id);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'The local download could not be removed. The audio file is still downloaded.',
      );
      return [];
    } finally {
      setRemovingIds(new Set());
    }
  }, [applyFiles]);

  const createFolder = useCallback(async (parentPath: string, name: string) => {
    setError(null);
    try {
      const folder = await PlayrICloud.createFolderAsync(parentPath, name);
      const nextFolders = [...foldersRef.current, folder];
      await applyOrganization(filesRef.current, nextFolders);
      return folder;
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'The folder could not be created.';
      setError(message);
      throw caughtError;
    }
  }, [applyOrganization]);

  const renameFolder = useCallback(async (relativePath: string, name: string) => {
    setError(null);
    try {
      const renamedFolder = await PlayrICloud.renameFolderAsync(relativePath, name);
      const remappedOrder = remapLibraryOrderPaths(
        orderRef.current,
        relativePath,
        renamedFolder.relativePath,
      );
      orderRef.current = remappedOrder;
      setOrderByFolder(remappedOrder);
      const remapPath = (path: string) =>
        path === relativePath || path.startsWith(`${relativePath}/`)
          ? `${renamedFolder.relativePath}${path.slice(relativePath.length)}`
          : path;
      const remappedReversedPaths = new Set([...reversedFolderPaths].map(remapPath));
      const remappedFolderPreferences = new Map(
        [...folderPreferencesRef.current].map(([path, preferences]) => [
          remapPath(path),
          preferences,
        ]),
      );
      setReversedFolderPaths(remappedReversedPaths);
      folderPreferencesRef.current = remappedFolderPreferences;
      setFolderPreferencesByPath(remappedFolderPreferences);
      await replaceLibraryOrder(remappedOrder);
      await replaceReversedFolderPaths(remappedReversedPaths);
      await remapFolderPathPrefix(relativePath, renamedFolder.relativePath);
      const [storedProgress, storedQueue] = await Promise.all([
        getPlaybackProgress(),
        getQueueIds(),
      ]);
      setProgressById(storedProgress);
      setQueueIds(storedQueue);
      await refresh();
      return renamedFolder;
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'The folder could not be renamed.';
      setError(message);
      throw caughtError;
    }
  }, [refresh, reversedFolderPaths]);

  const moveFile = useCallback(async (id: string, destinationFolderPath: string) => {
    setError(null);
    try {
      const movedFile = await PlayrICloud.moveAudioFileAsync(id, destinationFolderPath);
      await remapPlaybackFileId(id, movedFile.id);
      setProgressById((current) => {
        const progress = current.get(id);
        if (!progress) return current;
        const next = new Map(current);
        next.delete(id);
        next.set(movedFile.id, { ...progress, fileId: movedFile.id });
        return next;
      });
      setQueueIds((current) => current.map((fileId) => (fileId === id ? movedFile.id : fileId)));
      const nextFiles = filesRef.current.map((file) => (file.id === id ? movedFile : file));
      applyFiles(nextFiles);
      await replaceLibraryCache(nextFiles);
      await applyOrganization(nextFiles, foldersRef.current);
      return movedFile;
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'The audio file could not be moved.';
      setError(message);
      throw caughtError;
    }
  }, [applyFiles, applyOrganization]);

  const toggleFolderOrder = useCallback(async (parentPath: string) => {
    let nextValue = false;
    setReversedFolderPaths((current) => {
      const next = new Set(current);
      nextValue = !next.has(parentPath);
      if (nextValue) next.add(parentPath);
      else next.delete(parentPath);
      return next;
    });
    await saveFolderOrderReversed(parentPath, nextValue);
  }, []);

  const setFolderKeepDownloads = useCallback(async (parentPath: string, enabled: boolean) => {
    const current = folderPreferencesRef.current.get(parentPath) ?? DEFAULT_FOLDER_PREFERENCES;
    const nextPreferences = new Map(folderPreferencesRef.current).set(parentPath, {
      ...current,
      keepDownloads: enabled,
    });
    folderPreferencesRef.current = nextPreferences;
    setFolderPreferencesByPath(nextPreferences);
    await saveFolderKeepDownloads(parentPath, enabled);
  }, []);

  const setFolderRememberTimestamps = useCallback(
    async (parentPath: string, enabled: boolean) => {
      const current = folderPreferencesRef.current.get(parentPath) ?? DEFAULT_FOLDER_PREFERENCES;
      const nextPreferences = new Map(folderPreferencesRef.current).set(parentPath, {
        ...current,
        rememberTimestamps: enabled,
      });
      folderPreferencesRef.current = nextPreferences;
      setFolderPreferencesByPath(nextPreferences);
      await saveFolderRememberTimestamps(parentPath, enabled);
    },
    [],
  );

  const setAutoDownloadOnTap = useCallback(async (enabled: boolean) => {
    setAutoDownloadOnTapState(enabled);
    await saveAutoDownloadOnTap(enabled);
  }, []);

  const reorderFiles = useCallback(async (parentPath: string, displayedFileIds: string[]) => {
    const nextOrder = reorderFolderFiles(
      orderRef.current,
      parentPath,
      displayedFileIds,
      reversedFolderPaths.has(parentPath),
    );
    orderRef.current = nextOrder;
    setOrderByFolder(nextOrder);
    await replaceLibraryOrder(nextOrder);
  }, [reversedFolderPaths]);

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

  const reorderQueue = useCallback(async (fileIds: string[]) => {
    setQueueIds(fileIds);
    await replaceQueue(fileIds);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    files,
    folders,
    orderByFolder,
    reversedFolderPaths,
    folderPreferencesByPath,
    autoDownloadOnTap,
    progressById,
    queueIds,
    availability,
    isLoading,
    isRefreshing,
    error,
    removingIds,
    clearError,
    refresh,
    verifyFile,
    download,
    removeDownloads,
    createFolder,
    renameFolder,
    moveFile,
    reorderFiles,
    toggleFolderOrder,
    setFolderKeepDownloads,
    setFolderRememberTimestamps,
    setAutoDownloadOnTap,
    updateProgress,
    addToQueue,
    removeFromQueue,
    clearQueue,
    reorderQueue,
  };
}
