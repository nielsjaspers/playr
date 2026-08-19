import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  Button,
  Host,
  List,
  RNHostView,
  Spacer,
  SwipeActions,
  TabView,
  VStack,
} from '@expo/ui/swift-ui';
import {
  frame,
  labelStyle,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listStyle,
  scrollContentBackground,
  tabViewStyle,
} from '@expo/ui/swift-ui/modifiers';

import {
  PlayrLibraryView,
  type ICloudAudioFile,
  type PlayrLibraryAudioItem,
} from '../modules/playr-icloud';
import { EpisodeRow, formatDuration } from './components/EpisodeRow';
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
import { usePlayback } from './usePlayback';
import { usePlayrLibrary } from './usePlayrLibrary';
import { createPalette, GlassPanel, Icon, type Palette } from './ui';

type Screen = 'library' | 'queue';

function QueueEmptyState({ palette }: { palette: Palette }) {
  return (
    <View style={styles.emptyState}>
      <Icon name="text.badge.plus" color={palette.tertiaryLabel} size={36} />
      <Text style={[styles.emptyTitle, { color: palette.label }]}>Your queue is empty</Text>
      <Text style={[styles.emptyBody, { color: palette.secondaryLabel }]}>
        Add files from your library to play them in order.
      </Text>
    </View>
  );
}

export default function PlayrApp() {
  const isDark = useColorScheme() === 'dark';
  const palette = useMemo(() => createPalette(isDark), [isDark]);
  const library = usePlayrLibrary();
  const [screen, setScreen] = useState<Screen>('library');
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [queueCloudPrompt, setQueueCloudPrompt] = useState<ICloudAudioFile | null>(null);
  const [currentFolderPath, setCurrentFolderPath] = useState(ROOT_FOLDER_PATH);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchGlobally, setSearchGlobally] = useState(false);
  const filesRef = useRef(library.files);
  const queueIdsRef = useRef(library.queueIds);
  const playbackRef = useRef<ReturnType<typeof usePlayback> | null>(null);

  useEffect(() => {
    filesRef.current = library.files;
    queueIdsRef.current = library.queueIds;
  }, [library.files, library.queueIds]);

  const handleFinished = useCallback(
    (fileId: string) => {
      const remainingQueue = queueIdsRef.current.filter((id) => id !== fileId);
      if (queueIdsRef.current.includes(fileId)) void library.removeFromQueue(fileId);
      const nextFile = filesRef.current.find((file) => file.id === remainingQueue[0]);
      if (!nextFile) return;
      if (nextFile.downloadState === 'downloaded' && nextFile.localUri) {
        void playbackRef.current?.play(nextFile);
      } else {
        setQueueCloudPrompt(nextFile);
      }
    },
    [library.removeFromQueue],
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
      presentedError,
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

  const downloadAndMaybePlay = useCallback(
    async (file: ICloudAudioFile, playAfterDownload: boolean) => {
      try {
        const downloadedFiles = await library.download([file.id]);
        const downloadedFile = downloadedFiles.find((item) => item.id === file.id);
        if (downloadedFile && playAfterDownload) await playbackRef.current?.play(downloadedFile);
      } catch (caughtError) {
        setNotice(caughtError instanceof Error ? caughtError.message : 'The download failed.');
      }
    },
    [library.download],
  );

  useEffect(() => {
    if (!queueCloudPrompt) return;
    const file = queueCloudPrompt;
    setQueueCloudPrompt(null);
    Alert.alert(
      'Next item is in iCloud',
      `Download “${file.name}” and continue the queue?`,
      [
        { text: 'Not Now', style: 'cancel' },
        { text: 'Download', onPress: () => void downloadAndMaybePlay(file, true) },
      ],
    );
  }, [downloadAndMaybePlay, queueCloudPrompt]);

  const openFile = useCallback(
    async (file: ICloudAudioFile) => {
      try {
        const verifiedFile = await library.verifyFile(file.id);
        if (!verifiedFile) {
          setNotice('This file is no longer in the Playr iCloud folder.');
          return;
        }
        if (verifiedFile.downloadState === 'downloaded') {
          await playback.play(verifiedFile);
          return;
        }
        if (verifiedFile.downloadState === 'downloading') {
          setNotice(`${verifiedFile.name} is still downloading from iCloud.`);
          return;
        }
        Alert.alert(
          'Download from iCloud?',
          `“${verifiedFile.name}” is not stored on this iPhone. Download it and start playback?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Download and Play',
              onPress: () => void downloadAndMaybePlay(verifiedFile, true),
            },
          ],
        );
      } catch (caughtError) {
        setNotice(caughtError instanceof Error ? caughtError.message : 'The file could not open.');
      }
    },
    [downloadAndMaybePlay, library.verifyFile, playback.play],
  );

  const addFileToQueue = useCallback(
    async (file: ICloudAudioFile) => {
      await library.addToQueue(file.id);
      if (file.downloadState !== 'inCloud') return;
      Alert.alert(
        'Added to Queue',
        'This file is only in iCloud. Download it now, or wait until Playr reaches it?',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Download', onPress: () => void downloadAndMaybePlay(file, false) },
        ],
      );
    },
    [downloadAndMaybePlay, library.addToQueue],
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

  const pressEpisode = useCallback(
    (file: ICloudAudioFile) => {
      const intent = getEpisodePressIntent(file.id, playback.currentFile?.id ?? null);
      if (intent === 'toggle') {
        playback.toggle();
        return;
      }
      void openFile(file);
    },
    [openFile, playback.currentFile?.id, playback.toggle],
  );

  const renderMiniPlayer = () => {
    if (!playback.currentFile) return null;
    return (
      <View style={styles.miniPlayerPosition}>
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
        </GlassPanel>
      </View>
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
            onOpenFile={({ nativeEvent }) => {
              const file = library.files.find((item) => item.id === nativeEvent.id);
              if (file) pressEpisode(file);
            }}
            onOpenFolder={({ nativeEvent }) => {
              setCurrentFolderPath(nativeEvent.path);
              setSearchQuery('');
              setSearchGlobally(false);
            }}
            onRefresh={() => void library.refresh()}
            onRemoveAllDownloads={() => {
              const ids = library.files
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

    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.largeTitle, { color: palette.label }]}>Queue</Text>
          {library.queueIds.length > 0 ? (
            <Pressable onPress={() => void library.clearQueue()}>
              <Text style={[styles.clearButton, { color: palette.destructive }]}>Clear</Text>
            </Pressable>
          ) : null}
        </View>

        {library.availability !== 'available' ? (
          <View style={styles.icloudUnavailable}>
            <Icon name="icloud.slash" color={palette.secondaryLabel} size={30} />
            <Text style={[styles.emptyTitle, { color: palette.label }]}>
              iCloud Drive is unavailable
            </Text>
          </View>
        ) : library.isLoading ? (
          <ActivityIndicator color={palette.secondaryLabel} style={styles.loading} />
        ) : queueFiles.length === 0 ? (
          <QueueEmptyState palette={palette} />
        ) : (
          <Host
            colorScheme={isDark ? 'dark' : 'light'}
            seedColor={palette.label}
            style={[styles.episodeListHost, { backgroundColor: palette.background }]}
          >
            <List modifiers={[listStyle('plain'), scrollContentBackground('hidden')]}>
              {queueFiles.map((item) => (
                <SwipeActions
                  key={item.id}
                  modifiers={[
                    listRowBackground(palette.background),
                    listRowInsets({ top: 0, leading: 16, bottom: 0, trailing: 16 }),
                  ]}
                >
                  <VStack modifiers={[frame({ minHeight: 72 })]}>
                    <RNHostView>
                      <EpisodeRow
                        file={item}
                        isCurrent={playback.currentFile?.id === item.id}
                        isPlaying={playback.status.playing}
                        isRemoving={library.removingIds.has(item.id)}
                        isSelected={false}
                        isSelecting={false}
                        onPress={() => pressEpisode(item)}
                        onToggleSelection={() => undefined}
                        palette={palette}
                        progress={library.progressById.get(item.id)}
                      />
                    </RNHostView>
                  </VStack>
                  <SwipeActions.Actions edge="trailing">
                    <Button
                      label="Remove"
                      systemImage="trash"
                      role="destructive"
                      onPress={() => void library.removeFromQueue(item.id)}
                    />
                  </SwipeActions.Actions>
                </SwipeActions>
              ))}
              <Spacer
                modifiers={[
                  frame({ height: playback.currentFile ? 104 : 20 }),
                  listRowBackground(palette.background),
                  listRowSeparator('hidden'),
                ]}
              />
            </List>
          </Host>
        )}
        {renderMiniPlayer()}
      </SafeAreaView>
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
        onClose={() => setIsPlayerOpen(false)}
        palette={palette}
        playback={playback}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabHost: { flex: 1 },
  safeArea: { flex: 1 },
  nativeLibraryView: { flex: 1 },
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
});
