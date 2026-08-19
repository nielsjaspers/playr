import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Alert,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Host, RNHostView, TabView } from '@expo/ui/swift-ui';
import { labelStyle, tabViewStyle } from '@expo/ui/swift-ui/modifiers';

import {
  PlayrLibraryView,
  PlayrQueueView,
  type ICloudAudioFile,
  type PlayrLibraryAudioItem,
} from '../modules/playr-icloud';
import { formatDuration } from './components/EpisodeRow';
import { PlayerModal } from './components/PlayerModal';
import {
  getContinueListeningFiles,
  isDirectChild,
  orderFiles,
  orderFolders,
  parentFolderPath,
  ROOT_FOLDER_PATH,
  searchAudioTitles,
} from './libraryOrganization';
import { getEpisodePressIntent } from './playbackIntent';
import {
  createPlaybackOrder,
  createPlaybackSequence,
  cycleRepeatMode,
  getAdjacentPlaybackId,
  getCompletionTarget,
  type PlaybackSequence,
  type RepeatMode,
} from './playbackSequence';
import { cloudPlaybackBehavior } from './playbackPolicy';
import { usePlayback } from './usePlayback';
import { usePlayrLibrary } from './usePlayrLibrary';
import { createPalette, GlassPanel, Icon, type Palette } from './ui';

type Screen = 'library' | 'queue';

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function formatPresentedError(message: string) {
  if (message.includes('database is locked') || message.includes('SQLiteErrorException')) {
    return 'Playr could not finish saving your library. Please try again.';
  }
  return message;
}

export default function PlayrApp() {
  const isDark = useColorScheme() === 'dark';
  const viewport = useWindowDimensions();
  const palette = useMemo(() => createPalette(isDark), [isDark]);
  const library = usePlayrLibrary();
  const [screen, setScreen] = useState<Screen>('library');
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [currentFolderPath, setCurrentFolderPath] = useState(ROOT_FOLDER_PATH);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchGlobally, setSearchGlobally] = useState(false);
  const [playbackSequence, setPlaybackSequence] = useState<PlaybackSequence | null>(null);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const filesRef = useRef(library.files);
  const queueIdsRef = useRef(library.queueIds);
  const playbackSequenceRef = useRef(playbackSequence);
  const repeatModeRef = useRef(repeatMode);
  const shuffleEnabledRef = useRef(shuffleEnabled);
  const playbackRef = useRef<ReturnType<typeof usePlayback> | null>(null);
  const prepareAndPlayRef = useRef<((file: ICloudAudioFile) => Promise<boolean>) | null>(null);
  const downloadRef = useRef(library.download);
  const verifyFileRef = useRef(library.verifyFile);
  const folderPreferencesRef = useRef(library.folderPreferencesByPath);
  const preparingFilesRef = useRef(new Map<string, Promise<ICloudAudioFile>>());
  const miniPlayerTranslation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    filesRef.current = library.files;
    queueIdsRef.current = library.queueIds;
    downloadRef.current = library.download;
    verifyFileRef.current = library.verifyFile;
    folderPreferencesRef.current = library.folderPreferencesByPath;
  }, [
    library.download,
    library.files,
    library.folderPreferencesByPath,
    library.queueIds,
    library.verifyFile,
  ]);

  useEffect(() => {
    playbackSequenceRef.current = playbackSequence;
  }, [playbackSequence]);

  useEffect(() => {
    repeatModeRef.current = repeatMode;
  }, [repeatMode]);

  useEffect(() => {
    shuffleEnabledRef.current = shuffleEnabled;
  }, [shuffleEnabled]);

  const updatePlaybackSequence = useCallback((sequence: PlaybackSequence | null) => {
    playbackSequenceRef.current = sequence;
    setPlaybackSequence(sequence);
  }, []);

  const handleFinished = useCallback(
    (fileId: string) => {
      const sequence = playbackSequenceRef.current;
      if (!sequence) return;
      const targetId = getCompletionTarget(
        sequence.playOrderIds,
        fileId,
        repeatModeRef.current,
      );
      if (!targetId) return;
      if (targetId === fileId) {
        void playbackRef.current?.replay();
        return;
      }

      const nextFile = filesRef.current.find((file) => file.id === targetId);
      if (!nextFile) return;
      void prepareAndPlayRef.current?.(nextFile);
    },
    [],
  );

  const playback = usePlayback({
    progressById: library.progressById,
    onProgress: library.updateProgress,
    onFinished: handleFinished,
    onError: setNotice,
  });
  playbackRef.current = playback;

  const presentedError = library.error ?? notice;
  useEffect(() => {
    if (!presentedError) return;
    const isRemovalFailure = presentedError.includes('still downloaded');
    Alert.alert(
      isRemovalFailure ? 'Couldn’t Remove Download' : 'Playr Couldn’t Complete That',
      formatPresentedError(presentedError),
      [
        {
          text: 'OK',
          onPress: () => {
            library.clearError();
            setNotice(null);
          },
        },
      ],
    );
  }, [library.clearError, presentedError]);

  const rememberTimestampForFile = useCallback((file: ICloudAudioFile) => {
    return (
      folderPreferencesRef.current.get(parentFolderPath(file.relativePath))
        ?.rememberTimestamps ?? true
    );
  }, []);

  const playDownloadedFile = useCallback(
    async (file: ICloudAudioFile) => {
      await playbackRef.current?.play(file, {
        rememberTimestamp: rememberTimestampForFile(file),
      });
    },
    [rememberTimestampForFile],
  );

  const downloadFileToLocal = useCallback(async (file: ICloudAudioFile) => {
    let verifiedFile = await verifyFileRef.current(file.id);
    if (!verifiedFile) throw new Error('This file is no longer in the Playr iCloud folder.');
    if (verifiedFile.downloadState === 'downloaded' && verifiedFile.localUri) return verifiedFile;

    if (verifiedFile.downloadState === 'inCloud') {
      const downloadedFiles = await downloadRef.current([verifiedFile.id]);
      const downloadedFile = downloadedFiles.find((item) => item.id === verifiedFile?.id);
      if (downloadedFile?.localUri) return downloadedFile;
    }

    for (let attempt = 0; attempt < 120; attempt += 1) {
      await wait(500);
      verifiedFile = await verifyFileRef.current(file.id);
      if (verifiedFile?.downloadState === 'downloaded' && verifiedFile.localUri) {
        return verifiedFile;
      }
    }
    throw new Error('The iCloud download is taking longer than expected.');
  }, []);

  const prepareDownloadedFile = useCallback(
    (file: ICloudAudioFile) => {
      const existingPreparation = preparingFilesRef.current.get(file.id);
      if (existingPreparation) return existingPreparation;

      const preparation = downloadFileToLocal(file).finally(() => {
        preparingFilesRef.current.delete(file.id);
      });
      preparingFilesRef.current.set(file.id, preparation);
      return preparation;
    },
    [downloadFileToLocal],
  );

  const prepareAndPlay = useCallback(
    async (file: ICloudAudioFile) => {
      try {
        const downloadedFile = await prepareDownloadedFile(file);
        await playDownloadedFile(downloadedFile);
        return true;
      } catch (caughtError) {
        setNotice(caughtError instanceof Error ? caughtError.message : 'The download failed.');
        return false;
      }
    },
    [playDownloadedFile, prepareDownloadedFile],
  );
  prepareAndPlayRef.current = prepareAndPlay;

  useEffect(() => {
    const currentFile = playback.currentFile;
    const sequence = playbackSequence;
    if (!currentFile || !sequence) return;
    const targetId = getCompletionTarget(sequence.playOrderIds, currentFile.id, repeatMode);
    if (!targetId || targetId === currentFile.id) return;
    const targetFile = library.files.find((file) => file.id === targetId);
    if (targetFile?.downloadState !== 'inCloud') return;
    void prepareDownloadedFile(targetFile).catch(() => undefined);
  }, [library.files, playback.currentFile, playbackSequence, prepareDownloadedFile, repeatMode]);

  const openFile = useCallback(
    async (file: ICloudAudioFile) => {
      try {
        const verifiedFile = await library.verifyFile(file.id);
        if (!verifiedFile) {
          setNotice('This file is no longer in the Playr iCloud folder.');
          return;
        }
        if (verifiedFile.downloadState === 'downloaded') {
          await playDownloadedFile(verifiedFile);
          return;
        }
        if (verifiedFile.downloadState === 'downloading') {
          void prepareAndPlay(verifiedFile);
          return;
        }
        const cloudBehavior = cloudPlaybackBehavior('direct', library.autoDownloadOnTap);
        if (cloudBehavior === 'downloadAndPlay') {
          void prepareAndPlay(verifiedFile);
          return;
        }
        Alert.alert(
          'Download from iCloud?',
          `“${verifiedFile.name}” is not stored on this iPhone. Download it and start playback?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Download and Play',
              onPress: () => void prepareAndPlay(verifiedFile),
            },
            {
              text: 'Always Download',
              onPress: () => {
                void library.setAutoDownloadOnTap(true);
                void prepareAndPlay(verifiedFile);
              },
            },
          ],
        );
      } catch (caughtError) {
        setNotice(caughtError instanceof Error ? caughtError.message : 'The file could not open.');
      }
    },
    [
      library.autoDownloadOnTap,
      library.setAutoDownloadOnTap,
      library.verifyFile,
      playDownloadedFile,
      prepareAndPlay,
    ],
  );

  const addFileToQueue = useCallback(
    async (file: ICloudAudioFile) => {
      await library.addToQueue(file.id);
    },
    [library.addToQueue],
  );

  const removeFileDownloads = useCallback(
    async (ids: string[]) => {
      if (playback.currentFile && ids.includes(playback.currentFile.id)) await playback.stop();
      await library.removeDownloads(ids);
    },
    [library.removeDownloads, playback.currentFile, playback.stop],
  );

  const createFolder = useCallback(
    (parentPath: string) => {
      Alert.prompt(
        'New Folder',
        'Create a folder in your Playr library.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Create',
            onPress: (name?: string) => {
              if (!name?.trim()) return;
              void library.createFolder(parentPath, name).catch(() => undefined);
            },
          },
        ],
        'plain-text',
      );
    },
    [library.createFolder],
  );

  const renameCurrentFolder = useCallback(() => {
    const folder = library.folders.find((item) => item.relativePath === currentFolderPath);
    if (!folder) return;
    Alert.prompt(
      'Rename Folder',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rename',
          onPress: (name?: string) => {
            if (!name?.trim()) return;
            void (async () => {
              if (
                playback.currentFile &&
                (playback.currentFile.relativePath === currentFolderPath ||
                  playback.currentFile.relativePath.startsWith(`${currentFolderPath}/`))
              ) {
                await playback.stop();
              }
              const renamedFolder = await library.renameFolder(currentFolderPath, name);
              setCurrentFolderPath(renamedFolder.relativePath);
            })().catch(() => undefined);
          },
        },
      ],
      'plain-text',
      folder.name,
    );
  }, [currentFolderPath, library.folders, library.renameFolder, playback.currentFile, playback.stop]);

  const sequenceForFolderFile = useCallback(
    (file: ICloudAudioFile) => {
      const folderPath = parentFolderPath(file.relativePath);
      const folderFiles = orderFiles(
        library.files.filter((item) => isDirectChild(item.relativePath, folderPath)),
        folderPath,
        library.orderByFolder,
        library.reversedFolderPaths.has(folderPath),
      );
      return createPlaybackSequence(
        'folder',
        folderFiles.map((item) => item.id),
        folderPath,
        file.id,
        shuffleEnabledRef.current,
      );
    },
    [library.files, library.orderByFolder, library.reversedFolderPaths],
  );

  const pressEpisode = useCallback(
    (file: ICloudAudioFile, sequence: PlaybackSequence) => {
      updatePlaybackSequence(sequence);
      const intent = getEpisodePressIntent(file.id, playback.currentFile?.id ?? null);
      if (intent === 'toggle') {
        playback.toggle();
        return;
      }
      void openFile(file);
    },
    [openFile, playback.currentFile?.id, playback.toggle, updatePlaybackSequence],
  );

  const playFolder = useCallback(
    (folderPath: string, files: ICloudAudioFile[]) => {
      if (files.length === 0) return;
      const sequence = createPlaybackSequence(
        'folder',
        files.map((file) => file.id),
        folderPath,
        null,
        shuffleEnabledRef.current,
      );
      const firstId = sequence.playOrderIds[0];
      const firstFile = files.find((file) => file.id === firstId);
      if (!firstFile) return;
      updatePlaybackSequence(sequence);
      void prepareAndPlay(firstFile);
    },
    [prepareAndPlay, updatePlaybackSequence],
  );

  const playQueueFile = useCallback(
    (file: ICloudAudioFile) => {
      pressEpisode(
        file,
        createPlaybackSequence(
          'queue',
          queueIdsRef.current,
          null,
          file.id,
          shuffleEnabledRef.current,
        ),
      );
    },
    [pressEpisode],
  );

  const playAdjacent = useCallback(
    async (direction: 'next' | 'previous') => {
      const currentFile = playbackRef.current?.currentFile;
      const sequence = playbackSequenceRef.current;
      if (!currentFile || !sequence) return false;
      const targetId = getAdjacentPlaybackId(
        sequence.playOrderIds,
        currentFile.id,
        direction,
        repeatModeRef.current === 'all',
      );
      if (!targetId) return false;
      const targetFile = filesRef.current.find((file) => file.id === targetId);
      if (!targetFile) return false;
      return prepareAndPlay(targetFile);
    },
    [prepareAndPlay],
  );

  const toggleShuffle = useCallback(() => {
    const nextShuffleEnabled = !shuffleEnabledRef.current;
    shuffleEnabledRef.current = nextShuffleEnabled;
    setShuffleEnabled(nextShuffleEnabled);

    const sequence = playbackSequenceRef.current;
    if (!sequence) return;
    updatePlaybackSequence({
      ...sequence,
      playOrderIds: createPlaybackOrder(
        sequence.baseIds,
        playbackRef.current?.currentFile?.id ?? null,
        nextShuffleEnabled,
      ),
    });
  }, [updatePlaybackSequence]);

  const advanceRepeatMode = useCallback(() => {
    const nextMode = cycleRepeatMode(repeatModeRef.current);
    repeatModeRef.current = nextMode;
    setRepeatMode(nextMode);
  }, []);

  const miniPlayerPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_, gesture) => {
          miniPlayerTranslation.setValue(gesture.dx * 0.45);
        },
        onPanResponderRelease: (_, gesture) => {
          const direction = gesture.dx <= -64
            ? 'next'
            : gesture.dx >= 64
              ? 'previous'
              : null;
          if (direction) {
            const exitPosition = direction === 'next' ? -viewport.width : viewport.width;
            Animated.timing(miniPlayerTranslation, {
              toValue: exitPosition,
              duration: 160,
              useNativeDriver: true,
            }).start(({ finished }) => {
              if (!finished) return;
              void playAdjacent(direction).then((didMove) => {
                if (didMove) {
                  miniPlayerTranslation.setValue(-exitPosition);
                }
                Animated.spring(miniPlayerTranslation, {
                  toValue: 0,
                  damping: 20,
                  stiffness: 190,
                  useNativeDriver: true,
                }).start();
              });
            });
            return;
          }
          Animated.spring(miniPlayerTranslation, {
            toValue: 0,
            damping: 18,
            stiffness: 180,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(miniPlayerTranslation, {
            toValue: 0,
            damping: 18,
            stiffness: 180,
            useNativeDriver: true,
          }).start();
        },
      }),
    [miniPlayerTranslation, playAdjacent, viewport.width],
  );

  const renderMiniPlayer = () => {
    if (!playback.currentFile) return null;
    const progressFraction = playback.status.duration > 0
      ? Math.min(1, Math.max(0, playback.status.currentTime / playback.status.duration))
      : 0;
    return (
      <Animated.View
        {...miniPlayerPanResponder.panHandlers}
        style={[
          styles.miniPlayerPosition,
          { transform: [{ translateX: miniPlayerTranslation }] },
        ]}
      >
        <GlassPanel palette={palette} style={styles.miniPlayer}>
          <Pressable
            accessibilityLabel="Open now playing"
            accessibilityRole="button"
            onPress={() => setIsPlayerOpen(true)}
            style={({ pressed }) => [styles.miniOpenArea, { opacity: pressed ? 0.68 : 1 }]}
          >
            <View style={[styles.miniArtwork, { backgroundColor: palette.fill }]}>
              <Icon name="waveform" color={palette.accent} size={22} />
            </View>
            <View style={styles.miniText}>
              <Text numberOfLines={1} style={[styles.miniTitle, { color: palette.label }]}>
                {playback.currentFile.name}
              </Text>
              <Text style={[styles.miniDetail, { color: palette.secondaryLabel }]}>
                {formatDuration(playback.status.currentTime)} ·{' '}
                {playback.status.playing ? 'Playing' : 'Paused'}
              </Text>
            </View>
          </Pressable>
          <Pressable
            accessibilityLabel={playback.status.playing ? 'Pause' : 'Play'}
            accessibilityRole="button"
            hitSlop={8}
            onPress={playback.toggle}
            style={({ pressed }) => [styles.miniControl, { opacity: pressed ? 0.55 : 1 }]}
          >
            <Icon
              name={playback.status.playing ? 'pause.fill' : 'play.fill'}
              color={palette.label}
              size={23}
            />
          </Pressable>
          <View style={[styles.miniProgressTrack, { backgroundColor: palette.fill }]}>
            <View
              style={[
                styles.miniProgressFill,
                {
                  backgroundColor: palette.label,
                  width: `${progressFraction * 100}%`,
                },
              ]}
            />
          </View>
        </GlassPanel>
      </Animated.View>
    );
  };

  const renderLibraryScreen = () => {
    const currentFolder = library.folders.find(
      (folder) => folder.relativePath === currentFolderPath,
    );
    const isReversed = library.reversedFolderPaths.has(currentFolderPath);
    const directFiles = orderFiles(
      library.files.filter((file) => isDirectChild(file.relativePath, currentFolderPath)),
      currentFolderPath,
      library.orderByFolder,
      isReversed,
    );
    const childFolders = orderFolders(
      library.folders.filter((folder) => isDirectChild(folder.relativePath, currentFolderPath)),
      currentFolderPath,
      library.orderByFolder,
      isReversed,
    );
    const currentFolderPreferences = library.folderPreferencesByPath.get(currentFolderPath) ?? {
      keepDownloads: false,
      rememberTimestamps: true,
    };
    const continueListeningFiles = currentFolderPath === ROOT_FOLDER_PATH
      ? getContinueListeningFiles(library.files, library.progressById)
      : [];
    const searchResults = searchAudioTitles(
      library.files,
      searchQuery,
      currentFolderPath,
      searchGlobally,
    );

    const nativeItem = (
      file: ICloudAudioFile,
      contextLabel: string | null = null,
    ): PlayrLibraryAudioItem => {
      const progress = library.progressById.get(file.id);
      return {
        id: file.id,
        name: file.name,
        relativePath: file.relativePath,
        size: file.size,
        downloadState: file.downloadState,
        downloadProgress: file.downloadProgress,
        progressPosition: progress?.position ?? null,
        progressDuration: progress?.duration ?? null,
        completedAt: progress?.completedAt ?? null,
        contextLabel,
      };
    };

    const moveFiles = async (ids: string[], destinationFolderPath: string) => {
      if (playback.currentFile && ids.includes(playback.currentFile.id)) await playback.stop();
      for (const id of ids) await library.moveFile(id, destinationFolderPath);
    };

    return (
      <View style={[styles.safeArea, { backgroundColor: palette.background }]}>
        {library.availability !== 'available' ? (
          <View style={styles.icloudUnavailable}>
            <Icon name="icloud.slash" color={palette.secondaryLabel} size={30} />
            <Text style={[styles.emptyTitle, { color: palette.label }]}>
              iCloud Drive is unavailable
            </Text>
            <Text style={[styles.emptyBody, { color: palette.secondaryLabel }]}>
              Sign in to iCloud Drive in Settings, then reopen Playr.
            </Text>
          </View>
        ) : library.isLoading ? (
          <ActivityIndicator color={palette.secondaryLabel} style={styles.loading} />
        ) : (
          <PlayrLibraryView
            continueFiles={continueListeningFiles.map((file) =>
              nativeItem(file, parentFolderPath(file.relativePath) || 'Library'),
            )}
            currentFileId={playback.currentFile?.id ?? null}
            currentFolderPath={currentFolderPath}
            directFiles={directFiles.map((file) => nativeItem(file))}
            folders={childFolders}
            hasCloudFiles={directFiles.some((file) => file.downloadState === 'inCloud')}
            hasDownloadedFiles={directFiles.some(
              (file) => file.downloadState === 'downloaded',
            )}
            keepDownloads={currentFolderPreferences.keepDownloads}
            rememberTimestamps={currentFolderPreferences.rememberTimestamps}
            isPlaying={playback.status.playing}
            isRefreshing={library.isRefreshing}
            isReversed={isReversed}
            onAddToQueue={({ nativeEvent }) => {
              const file = library.files.find((item) => item.id === nativeEvent.id);
              if (file) void addFileToQueue(file);
            }}
            onBack={() => {
              setCurrentFolderPath(parentFolderPath(currentFolderPath));
              setSearchQuery('');
              setSearchGlobally(false);
            }}
            onCreateFolder={() => createFolder(currentFolderPath)}
            onDownloadFiles={({ nativeEvent }) => {
              const ids = nativeEvent.ids.filter(
                (id) => library.files.find((file) => file.id === id)?.downloadState === 'inCloud',
              );
              if (ids.length > 0) void library.download(ids);
            }}
            onMoveFiles={({ nativeEvent }) => {
              void moveFiles(nativeEvent.ids, nativeEvent.destinationFolderPath).catch(
                () => undefined,
              );
            }}
            onDownloadFolder={() => {
              const ids = directFiles
                .filter((file) => file.downloadState === 'inCloud')
                .map((file) => file.id);
              if (ids.length > 0) void library.download(ids);
            }}
            onKeepDownloadsChange={({ nativeEvent }) => {
              void library.setFolderKeepDownloads(currentFolderPath, nativeEvent.enabled);
            }}
            onOpenFile={({ nativeEvent }) => {
              const file = library.files.find((item) => item.id === nativeEvent.id);
              if (file) pressEpisode(file, sequenceForFolderFile(file));
            }}
            onOpenFolder={({ nativeEvent }) => {
              setCurrentFolderPath(nativeEvent.path);
              setSearchQuery('');
              setSearchGlobally(false);
            }}
            onPlayFolder={() => playFolder(currentFolderPath, directFiles)}
            onRefresh={() => void library.refresh()}
            onRememberTimestampsChange={({ nativeEvent }) => {
              void library.setFolderRememberTimestamps(currentFolderPath, nativeEvent.enabled);
            }}
            onRemoveFolderDownloads={() => {
              const ids = directFiles
                .filter((file) => file.downloadState === 'downloaded')
                .map((file) => file.id);
              if (ids.length > 0) void removeFileDownloads(ids);
            }}
            onRemoveDownloads={({ nativeEvent }) => {
              const ids = nativeEvent.ids.filter(
                (id) => library.files.find((file) => file.id === id)?.downloadState === 'downloaded',
              );
              if (ids.length > 0) void removeFileDownloads(ids);
            }}
            onRenameFolder={renameCurrentFolder}
            onReorderFiles={({ nativeEvent }) => {
              void library.reorderFiles(currentFolderPath, nativeEvent.ids);
            }}
            onSearchChange={({ nativeEvent }) => setSearchQuery(nativeEvent.query)}
            onSearchScopeChange={({ nativeEvent }) => setSearchGlobally(nativeEvent.global)}
            onToggleOrder={() => void library.toggleFolderOrder(currentFolderPath)}
            queuedIds={library.queueIds}
            removingIds={[...library.removingIds]}
            searchGlobally={searchGlobally}
            searchQuery={searchQuery}
            searchResults={searchResults.map((file) =>
              nativeItem(file, parentFolderPath(file.relativePath) || 'Library'),
            )}
            style={styles.nativeLibraryView}
            title={currentFolder?.name ?? 'Library'}
          />
        )}
        {renderMiniPlayer()}
      </View>
    );
  };

  const renderQueueScreen = () => {
    const queueFiles = library.queueIds
      .map((id) => library.files.find((file) => file.id === id))
      .filter((file): file is ICloudAudioFile => file != null);

    const nativeQueueFiles: PlayrLibraryAudioItem[] = queueFiles.map((file) => {
      const progress = library.progressById.get(file.id);
      return {
        id: file.id,
        name: file.name,
        relativePath: file.relativePath,
        size: file.size,
        downloadState: file.downloadState,
        downloadProgress: file.downloadProgress,
        progressPosition: progress?.position ?? null,
        progressDuration: progress?.duration ?? null,
        completedAt: progress?.completedAt ?? null,
        contextLabel: parentFolderPath(file.relativePath) || 'Library',
      };
    });

    return (
      <View style={[styles.safeArea, { backgroundColor: palette.background }]}>
        {library.availability !== 'available' ? (
          <View style={styles.icloudUnavailable}>
            <Icon name="icloud.slash" color={palette.secondaryLabel} size={30} />
            <Text style={[styles.emptyTitle, { color: palette.label }]}>
              iCloud Drive is unavailable
            </Text>
          </View>
        ) : library.isLoading ? (
          <ActivityIndicator color={palette.secondaryLabel} style={styles.loading} />
        ) : (
          <PlayrQueueView
            currentFileId={playback.currentFile?.id ?? null}
            files={nativeQueueFiles}
            isPlaying={playback.status.playing}
            onClear={() => {
              if (playbackSequenceRef.current?.kind === 'queue') updatePlaybackSequence(null);
              void library.clearQueue();
            }}
            onOpenFile={({ nativeEvent }) => {
              const file = library.files.find((item) => item.id === nativeEvent.id);
              if (file) playQueueFile(file);
            }}
            onRemoveFromQueue={({ nativeEvent }) => {
              if (playbackSequenceRef.current?.kind === 'queue') {
                const remainingIds = playbackSequenceRef.current.baseIds.filter(
                  (id) => id !== nativeEvent.id,
                );
                updatePlaybackSequence(
                  createPlaybackSequence(
                    'queue',
                    remainingIds,
                    null,
                    playback.currentFile?.id ?? null,
                    shuffleEnabledRef.current,
                  ),
                );
              }
              void library.removeFromQueue(nativeEvent.id);
            }}
            onReorder={({ nativeEvent }) => {
              if (playbackSequenceRef.current?.kind === 'queue') {
                updatePlaybackSequence(
                  createPlaybackSequence(
                    'queue',
                    nativeEvent.ids,
                    null,
                    playback.currentFile?.id ?? null,
                    shuffleEnabledRef.current,
                  ),
                );
              }
              void library.reorderQueue(nativeEvent.ids);
            }}
            style={styles.nativeQueueView}
          />
        )}
        {renderMiniPlayer()}
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Host
        colorScheme={isDark ? 'dark' : 'light'}
        seedColor={palette.accent}
        style={styles.tabHost}
        useViewportSizeMeasurement
      >
        <TabView
          selection={screen}
          onSelectionChange={(selection) => {
            if (selection === 'library' || selection === 'queue') setScreen(selection);
          }}
          modifiers={[tabViewStyle({ type: 'automatic' }), labelStyle('iconOnly')]}
        >
          <TabView.Tab value="library" systemImage="music.note.list">
            <RNHostView>{renderLibraryScreen()}</RNHostView>
          </TabView.Tab>
          <TabView.Tab value="queue" systemImage="text.badge.plus">
            <RNHostView>{renderQueueScreen()}</RNHostView>
          </TabView.Tab>
        </TabView>
      </Host>

      <PlayerModal
        isVisible={isPlayerOpen}
        onCycleRepeat={advanceRepeatMode}
        onClose={() => setIsPlayerOpen(false)}
        onNext={() => playAdjacent('next')}
        onPrevious={() => playAdjacent('previous')}
        onToggleShuffle={toggleShuffle}
        palette={palette}
        playback={playback}
        repeatMode={repeatMode}
        shuffleEnabled={shuffleEnabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabHost: { flex: 1 },
  safeArea: { flex: 1 },
  nativeLibraryView: { flex: 1 },
  nativeQueueView: { flex: 1 },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: 0.2 },
  episodeListHost: { flex: 1 },
  clearButton: { fontSize: 15, fontWeight: '500' },
  loading: { marginTop: 56 },
  emptyState: { alignItems: 'center', paddingHorizontal: 34, paddingTop: 56 },
  icloudUnavailable: { alignItems: 'center', paddingHorizontal: 28, paddingTop: 46 },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: 13, textAlign: 'center' },
  emptyBody: { fontSize: 14, lineHeight: 20, marginTop: 7, textAlign: 'center' },
  miniPlayerPosition: { bottom: 12, left: 12, position: 'absolute', right: 12 },
  miniPlayer: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: 30,
    flexDirection: 'row',
    height: 72,
    paddingHorizontal: 10,
  },
  miniOpenArea: { alignItems: 'center', flex: 1, flexDirection: 'row', minWidth: 0 },
  miniArtwork: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: 16,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  miniText: { flex: 1, marginLeft: 11 },
  miniTitle: { fontSize: 15, fontWeight: '600' },
  miniDetail: { fontSize: 12, marginTop: 3 },
  miniControl: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  miniProgressTrack: {
    bottom: 0,
    height: 2,
    left: 22,
    overflow: 'hidden',
    position: 'absolute',
    right: 22,
  },
  miniProgressFill: { height: '100%' },
});
