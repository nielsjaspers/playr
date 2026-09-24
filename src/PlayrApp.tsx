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
import { usePlaybackFlow } from './usePlaybackFlow';
import { usePlayback } from './usePlayback';
import { usePlayrLibrary } from './usePlayrLibrary';
import { createPalette, GlassPanel, Icon, type Palette } from './ui';

type Screen = 'library' | 'queue';

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
  const miniPlayerTranslation = useRef(new Animated.Value(0)).current;
  const finishRef = useRef<(() => void) | null>(null);
  const handleFinished = useCallback(() => finishRef.current?.(), []);
  const playback = usePlayback({
    progressById: library.progressById,
    onProgress: library.updateProgress,
    onFinished: handleFinished,
    onError: setNotice,
  });
  const flow = usePlaybackFlow(library, playback, setNotice);
  finishRef.current = () => { void flow.navigate('finished'); };
  const { repeatMode, shuffleEnabled, toggleShuffle, advanceRepeatMode, playFolder } = flow;
  const playAdjacent = flow.navigate;
  const report = useCallback((operation: Promise<unknown>) => {
    void operation.catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'The action could not finish.'));
  }, []);

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

  const addFileToQueue = useCallback(
    async (file: ICloudAudioFile) => {
      await library.addToQueue(file.id);
    },
    [library.addToQueue],
  );

  const removeFileDownloads = useCallback(
    async (ids: string[]) => {
      if (flow.pending && ids.includes(flow.pending.id)) flow.cancelPending();
      if (playback.currentFile && ids.includes(playback.currentFile.id)) await flow.stop();
      await library.removeDownloads(ids);
    },
    [library.removeDownloads, playback.currentFile, flow.stop, flow.pending, flow.cancelPending],
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
            if (!name?.trim() || name.trim() === folder.name) return;
            flow.cancelPending();
            report((async () => {
              if (
                playback.currentFile &&
                (playback.currentFile.relativePath === currentFolderPath ||
                  playback.currentFile.relativePath.startsWith(`${currentFolderPath}/`))
              ) {
                await flow.stop();
              }
              const renamedFolder = await library.renameFolder(currentFolderPath, name);
              flow.remapPath(currentFolderPath, renamedFolder.relativePath);
              setCurrentFolderPath(renamedFolder.relativePath);
            })());
          },
        },
      ],
      'plain-text',
      folder.name,
    );
  }, [currentFolderPath, library.folders, library.renameFolder, playback.currentFile, flow.stop, flow.cancelPending, flow.remapPath, report]);

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
            report(playAdjacent(direction));
            Animated.spring(miniPlayerTranslation, {
              toValue: 0, damping: 20, stiffness: 190, useNativeDriver: true,
            }).start();
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
    [miniPlayerTranslation, playAdjacent, report],
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
            onPress={flow.toggle}
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

  const nativeItem = useCallback((
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
    }, [library.progressById]);

  const filesById = useMemo(() => new Map(library.files.map((file) => [file.id, file])), [library.files]);
  const libraryScreen = useMemo(() => {
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

    return { currentFolder, isReversed, directFiles, childFolders, currentFolderPreferences,
      nativeDirectFiles: directFiles.map((file) => nativeItem(file)),
      nativeContinueFiles: continueListeningFiles.map((file) => nativeItem(file, parentFolderPath(file.relativePath) || 'Library')),
      nativeSearchResults: searchResults.map((file) => nativeItem(file, parentFolderPath(file.relativePath) || 'Library')),
      hasCloudFiles: directFiles.some((file) => file.downloadState === 'inCloud'),
      hasDownloadedFiles: directFiles.some((file) => file.downloadState === 'downloaded'),
    };
  }, [library.files, library.folders, library.orderByFolder, library.reversedFolderPaths,
      library.folderPreferencesByPath, library.progressById, currentFolderPath, searchQuery, searchGlobally, nativeItem]);
  const queueScreen = useMemo(() => {
    const items = (ids: string[]) => ids.flatMap((id) => {
      const file = filesById.get(id);
      return file ? [nativeItem(file, parentFolderPath(file.relativePath) || 'Library')] : [];
    });
    return { nativeQueueFiles: items(library.queueIds), continuationFiles: items(flow.continuationIds) };
  }, [filesById, nativeItem, library.queueIds, flow.continuationIds]);
  const removingIds = useMemo(() => [...library.removingIds], [library.removingIds]);

  const renderLibraryScreen = () => {
    const { currentFolder, isReversed, directFiles, childFolders, currentFolderPreferences } = libraryScreen;
    const moveFiles = async (ids: string[], destinationFolderPath: string) => {
      flow.cancelPending();
      if (playback.currentFile && ids.includes(playback.currentFile.id)) await flow.stop();
      for (const id of ids) {
        const moved = await library.moveFile(id, destinationFolderPath);
        flow.remapPath(id, moved.id);
      }
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
            documentsUri={library.documentsUri}
            continueFiles={libraryScreen.nativeContinueFiles}
            currentFileId={playback.currentFile?.id ?? null}
            currentFolderPath={currentFolderPath}
            directFiles={libraryScreen.nativeDirectFiles}
            folders={childFolders}
            hasCloudFiles={libraryScreen.hasCloudFiles}
            hasDownloadedFiles={libraryScreen.hasDownloadedFiles}
            keepDownloads={currentFolderPreferences.keepDownloads}
            rememberTimestamps={currentFolderPreferences.rememberTimestamps}
            isPlaying={playback.status.playing}
            isRefreshing={library.isRefreshing}
            isReversed={isReversed}
            onAddToQueue={({ nativeEvent }) => {
              const file = filesById.get(nativeEvent.id);
              if (file) report(addFileToQueue(file));
            }}
            onBack={() => {
              setCurrentFolderPath(parentFolderPath(currentFolderPath));
              setSearchQuery('');
              setSearchGlobally(false);
            }}
            onCreateFolder={() => createFolder(currentFolderPath)}
            onDownloadFiles={({ nativeEvent }) => {
              const ids = nativeEvent.ids.filter(
                (id) => filesById.get(id)?.downloadState === 'inCloud',
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
              report(library.setFolderKeepDownloads(currentFolderPath, nativeEvent.enabled));
            }}
            onOpenFile={({ nativeEvent }) => {
              const file = filesById.get(nativeEvent.id);
              if (file) flow.openLibraryFile(file);
            }}
            onOpenFolder={({ nativeEvent }) => {
              setCurrentFolderPath(nativeEvent.path);
              setSearchQuery('');
              setSearchGlobally(false);
            }}
            onPlayFolder={() => playFolder(currentFolderPath, directFiles)}
            onRefresh={() => void library.refresh()}
            onRememberTimestampsChange={({ nativeEvent }) => {
              report(library.setFolderRememberTimestamps(currentFolderPath, nativeEvent.enabled));
            }}
            onRemoveFolderDownloads={() => {
              const ids = directFiles
                .filter((file) => file.downloadState === 'downloaded')
                .map((file) => file.id);
              if (ids.length > 0) report(removeFileDownloads(ids));
            }}
            onRemoveDownloads={({ nativeEvent }) => {
              const ids = nativeEvent.ids.filter(
                (id) => filesById.get(id)?.downloadState === 'downloaded',
              );
              if (ids.length > 0) report(removeFileDownloads(ids));
            }}
            onRenameFolder={renameCurrentFolder}
            onReorderFiles={({ nativeEvent }) => {
              report(library.reorderFiles(currentFolderPath, nativeEvent.ids));
            }}
            onSearchChange={({ nativeEvent }) => setSearchQuery(nativeEvent.query)}
            onSearchScopeChange={({ nativeEvent }) => setSearchGlobally(nativeEvent.global)}
            onToggleOrder={() => report(library.toggleFolderOrder(currentFolderPath))}
            queuedIds={library.queueIds}
            removingIds={removingIds}
            searchGlobally={searchGlobally}
            searchQuery={searchQuery}
            searchResults={libraryScreen.nativeSearchResults}
            style={styles.nativeLibraryView}
            title={currentFolder?.name ?? 'Library'}
          />
        )}
        {renderMiniPlayer()}
      </View>
    );
  };

  const renderQueueScreen = () => {
    const { nativeQueueFiles, continuationFiles } = queueScreen;
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
            onClear={() => report(library.clearQueue())}
            onOpenFile={({ nativeEvent }) => report(flow.openQueueFile(nativeEvent.id))}
            onRemoveFromQueue={({ nativeEvent }) => report(library.removeFromQueue(nativeEvent.id))}
            onReorder={({ nativeEvent }) => report(library.reorderQueue(nativeEvent.ids))}
            continuationFiles={continuationFiles}
            onOpenContinuation={({ nativeEvent }) => report(flow.openContinuation(nativeEvent.id))}
            onReorderContinuation={({ nativeEvent }) => flow.reorderContinuation(nativeEvent.ids)}
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
      {flow.pending && (
        <View style={styles.pendingBar}>
          <ActivityIndicator color={palette.secondaryLabel} />
          <Text numberOfLines={1} style={[styles.pendingText, { color: palette.label }]}>
            Preparing {library.files.find((file) => file.id === flow.pending?.id)?.name ?? 'episode'}
          </Text>
          <Pressable accessibilityRole="button" onPress={flow.cancelPending} hitSlop={12}>
            <Text style={{ color: palette.accent }}>Cancel</Text>
          </Pressable>
        </View>
      )}
      {playback.progressSaveError && (
        <Text accessibilityRole="alert" style={{ color: palette.secondaryLabel, padding: 12 }}>{playback.progressSaveError}</Text>
      )}
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
        playback={{ ...playback, toggle: async () => flow.toggle() }}
        repeatMode={repeatMode}
        shuffleEnabled={shuffleEnabled}
        pendingName={flow.pending ? library.files.find((file) => file.id === flow.pending?.id)?.name ?? 'episode' : null}
        onCancelPending={flow.cancelPending}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pendingBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
  pendingText: { flex: 1 },
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
