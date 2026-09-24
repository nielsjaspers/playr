import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import PlayrICloud, {
  type ICloudAudioFile,
  type ICloudAvailability,
  type ICloudFolder,
} from '../modules/playr-icloud';
import { createLibraryRefresh } from './libraryRefresh';
import { moveItemsBefore } from './queueOrder';
import { createFilePreparation } from './filePreparation';
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
  getQueueIds as getStoredQueueIds,
  getReversedFolderPaths,
  remapFolderPathPrefix,
  remapPlaybackFileId,
  removeFromQueue as persistQueueRemoval,
  replaceLibraryCache,
  replaceLibraryOrder,
  replaceQueue,
  saveAutoDownloadOnTap,
  saveFolderKeepDownloads,
  saveFolderOrderReversed,
  saveFolderRememberTimestamps,
  savePlaybackProgress,
  upsertLibraryFiles,
  type FolderPreferences,
  type PlaybackProgress,
} from './storage';

const COMPLETED_DOWNLOAD_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_FOLDER_PREFERENCES: FolderPreferences = {
  keepDownloads: false,
  rememberTimestamps: true,
};

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
  const reversedPathsRef = useRef(reversedFolderPaths);
  const queueRef = useRef(queueIds);
  const filesRef = useRef(files);
  const foldersRef = useRef(folders);
  const orderRef = useRef(orderByFolder);
  const folderPreferencesRef = useRef(folderPreferencesByPath);
  const hasInitialized = useRef(false);
  const scans = useRef(createLibraryRefresh());
  const activeRefresh = useRef(0);
  const protectedIds = useRef(new Set<string>());
  const [documentsUri, setDocumentsUri] = useState<string | null>(null);
  const protectDownloads = useCallback((ids: string[]) => { protectedIds.current = new Set(ids); }, []);

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
            !protectedIds.current.has(file.id) &&
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

  const refresh = useCallback(() => scans.current.run(async (isCurrent) => {
    const request = ++activeRefresh.current;
    setIsRefreshing(true);
    try {
      const nextAvailability = await PlayrICloud.getAvailabilityAsync();
      if (!isCurrent()) return;
      setAvailability(nextAvailability);
      if (nextAvailability !== 'available') { setDocumentsUri(null); return; }
      await PlayrICloud.ensureLibraryAsync();
      if (!isCurrent()) return;
      const snapshot = await PlayrICloud.scanLibraryAsync();
      if (!isCurrent()) return;
      const listedFiles = mergeListedFiles(filesRef.current, snapshot.files, snapshot.complete);
      const cleanedFiles = await removeOverdueDownloads(listedFiles);
      if (!isCurrent()) return;
      setDocumentsUri(snapshot.documentsUri);
      const nextFolders = snapshot.complete ? snapshot.folders : [...new Map([
        ...foldersRef.current.map((folder) => [folder.id, folder] as const),
        ...snapshot.folders.map((folder) => [folder.id, folder] as const),
      ]).values()];
      applyFiles(cleanedFiles);
      await replaceLibraryCache(cleanedFiles);
      if (!isCurrent()) return;
      // Incomplete scans cannot prove deletion, so leave persisted ordering intact.
      if (snapshot.complete) await applyOrganization(cleanedFiles, nextFolders);
      else { foldersRef.current = nextFolders; setFolders(nextFolders); }
      if (snapshot.complete && isCurrent()) {
        const availableIds = new Set(cleanedFiles.map((file) => file.id));
        const remainingQueue = queueRef.current.filter((id) => availableIds.has(id));
        if (remainingQueue.length !== queueRef.current.length) {
          queueRef.current = remainingQueue;
          setQueueIds(remainingQueue);
          await replaceQueue(remainingQueue);
        }
      }
      if (isCurrent()) setError(null);
    } catch (caughtError) {
      if (isCurrent()) setError(caughtError instanceof Error ? caughtError.message : 'The library could not refresh.');
    } finally {
      if (request === activeRefresh.current) {
        setIsRefreshing(false);
        setIsLoading(false);
      }
    }
  }), [applyFiles, applyOrganization, removeOverdueDownloads]);

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
        getStoredQueueIds(),
        getLibraryOrder(),
        getReversedFolderPaths(),
        getFolderPreferences(),
        getAutoDownloadOnTap(),
      ]);
      if (!isMounted) return;

      applyFiles(cachedFiles);
      setProgressById(storedProgress);
      queueRef.current = storedQueue;
      setQueueIds(storedQueue);
      orderRef.current = storedOrder;
      setOrderByFolder(storedOrder);
      reversedPathsRef.current = storedReversedPaths;
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
      scans.current.invalidate();
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

  const verifyFile = useCallback(async (id: string) => {
    const [verifiedFile] = await PlayrICloud.getAudioFilesAsync([id]);
    if (!verifiedFile) return null;
    const nextFiles = replaceVerifiedFiles(filesRef.current, [verifiedFile]);
    if (nextFiles !== filesRef.current) {
      scans.current.invalidate();
      applyFiles(nextFiles);
      await upsertLibraryFiles([verifiedFile]);
    }
    return verifiedFile;
  }, [applyFiles]);

  const preparationRef = useRef<ReturnType<typeof createFilePreparation> | null>(null);
  if (!preparationRef.current) preparationRef.current = createFilePreparation({
    verify: verifyFile,
    request: async (id) => {
      const [result] = await PlayrICloud.requestDownloadsAsync([id]);
      if (!result?.succeeded) throw new Error(result?.error ?? 'The download could not start.');
      scans.current.invalidate();
      applyFiles(filesRef.current.map((file) => file.id === id ? { ...file, downloadState: 'downloading' } : file));
    },
  });
  const prepareFile = preparationRef.current;
  const download = useCallback(async (ids: string[]) => {
    const results = await Promise.allSettled(ids.map(prepareFile));
    const downloaded: ICloudAudioFile[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') downloaded.push(result.value);
      else setError(result.reason instanceof Error ? result.reason.message : 'A download could not finish.');
    }
    return downloaded;
  }, [prepareFile]);

  const removeDownloads = useCallback(async (ids: string[]) => {
    scans.current.invalidate();
    setError(null);
    setRemovingIds(new Set(ids));
    try {
      const results = await removeDownloadsWithLockRetry(
        ids,
        (retryIds) => PlayrICloud.removeDownloadsAsync(retryIds),
      );
      const verifiedFiles = await PlayrICloud.getAudioFilesAsync(ids);
      scans.current.invalidate();
      const nextFiles = replaceVerifiedFiles(filesRef.current, verifiedFiles);
      applyFiles(nextFiles);
      await replaceLibraryCache(nextFiles);

      const failure = results.find((result) => !result.succeeded);
      if (failure) setError(formatRemovalFailure(failure));
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
    scans.current.invalidate();
    setError(null);
    try {
      const folder = await PlayrICloud.createFolderAsync(parentPath, name);
      scans.current.invalidate();
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
    scans.current.invalidate();
    setError(null);
    try {
      const renamedFolder = await PlayrICloud.renameFolderAsync(relativePath, name);
      scans.current.invalidate();
      if (renamedFolder.relativePath === relativePath) return renamedFolder;
      await remapFolderPathPrefix(relativePath, renamedFolder.relativePath);
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
      const remappedReversedPaths = new Set([...reversedPathsRef.current].map(remapPath));
      const remappedFolderPreferences = new Map(
        [...folderPreferencesRef.current].map(([path, preferences]) => [
          remapPath(path),
          preferences,
        ]),
      );
      reversedPathsRef.current = remappedReversedPaths;
      setReversedFolderPaths(remappedReversedPaths);
      folderPreferencesRef.current = remappedFolderPreferences;
      setFolderPreferencesByPath(remappedFolderPreferences);
      const [storedProgress, storedQueue] = await Promise.all([
        getPlaybackProgress(),
        getStoredQueueIds(),
      ]);
      setProgressById(storedProgress);
      queueRef.current = storedQueue;
      setQueueIds(storedQueue);
      await refresh();
      return renamedFolder;
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'The folder could not be renamed.';
      setError(message);
      throw caughtError;
    }
  }, [refresh]);

  const moveFile = useCallback(async (id: string, destinationFolderPath: string) => {
    scans.current.invalidate();
    setError(null);
    try {
      const movedFile = await PlayrICloud.moveAudioFileAsync(id, destinationFolderPath);
      scans.current.invalidate();
      await remapPlaybackFileId(id, movedFile.id);
      setProgressById((current) => {
        const progress = current.get(id);
        if (!progress) return current;
        const next = new Map(current);
        next.delete(id);
        next.set(movedFile.id, { ...progress, fileId: movedFile.id });
        return next;
      });
      queueRef.current = queueRef.current.map((fileId) => fileId === id ? movedFile.id : fileId);
      setQueueIds(queueRef.current);
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
    const next = new Set(reversedPathsRef.current);
    const nextValue = !next.has(parentPath);
    if (nextValue) next.add(parentPath);
    else next.delete(parentPath);
    reversedPathsRef.current = next;
    setReversedFolderPaths(next);
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
    scans.current.invalidate();
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

  const getQueueIds = useCallback(() => queueRef.current, []);
  const addToQueue = useCallback(async (fileId: string) => {
    if (queueRef.current.includes(fileId)) return;
    queueRef.current = [...queueRef.current, fileId];
    setQueueIds(queueRef.current);
    await persistQueueItem(fileId);
  }, []);

  const removeFromQueue = useCallback(async (fileId: string) => {
    queueRef.current = queueRef.current.filter((id) => id !== fileId);
    setQueueIds(queueRef.current);
    await persistQueueRemoval(fileId);
  }, []);

  const clearQueue = useCallback(async () => {
    queueRef.current = [];
    setQueueIds([]);
    await persistQueueClear();
  }, []);

  const moveQueueItems = useCallback(async (fileIds: string[], beforeId: string | null, fromQueue: boolean) => {
    const available = new Set(filesRef.current.map((file) => file.id));
    queueRef.current = moveItemsBefore(queueRef.current, fileIds.filter((id) => available.has(id)), beforeId, !fromQueue);
    setQueueIds(queueRef.current);
    await replaceQueue(queueRef.current);
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
    documentsUri,
    protectDownloads,
    isLoading,
    isRefreshing,
    error,
    removingIds,
    clearError,
    refresh,
    verifyFile,
    download,
    prepareFile,
    getQueueIds,
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
    moveQueueItems,
  };
}
