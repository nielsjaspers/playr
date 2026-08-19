import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Button, Host, Menu, RNHostView, TabView } from '@expo/ui/swift-ui';
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled,
  foregroundStyle,
  labelStyle,
  menuIndicator,
  menuOrder,
  tabViewStyle,
} from '@expo/ui/swift-ui/modifiers';

import type { ICloudAudioFile } from '../modules/playr-icloud';
import { EpisodeRow, formatDuration } from './components/EpisodeRow';
import { PlayerModal } from './components/PlayerModal';
import { usePlayback } from './usePlayback';
import { usePlayrLibrary } from './usePlayrLibrary';
import { createPalette, GlassPanel, Icon, type Palette } from './ui';

type Screen = 'library' | 'queue';

function EmptyState({ screen, palette }: { screen: Screen; palette: Palette }) {
  return (
    <View style={styles.emptyState}>
      <Icon
        name={screen === 'library' ? 'music.note.list' : 'text.badge.plus'}
        color={palette.tertiaryLabel}
        size={36}
      />
      <Text style={[styles.emptyTitle, { color: palette.label }]}>
        {screen === 'library' ? 'No audio files' : 'Your queue is empty'}
      </Text>
      <Text style={[styles.emptyBody, { color: palette.secondaryLabel }]}>
        {screen === 'library'
          ? 'Add an MP3, M4A, or M4B file to iCloud Drive › Playr.'
          : 'Add files from your library to play them in order.'}
      </Text>
    </View>
  );
}

export default function PlayrApp() {
  const isDark = useColorScheme() === 'dark';
  const palette = useMemo(() => createPalette(isDark), [isDark]);
  const library = usePlayrLibrary();
  const [screen, setScreen] = useState<Screen>('library');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [queueCloudPrompt, setQueueCloudPrompt] = useState<ICloudAudioFile | null>(null);
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

  const handlePlaybackError = useCallback((message: string) => setNotice(message), []);
  const playback = usePlayback({
    progressById: library.progressById,
    onProgress: library.updateProgress,
    onFinished: handleFinished,
    onError: handlePlaybackError,
  });
  playbackRef.current = playback;

  const downloadAndMaybePlay = useCallback(
    async (file: ICloudAudioFile, playAfterDownload: boolean) => {
      setNotice(`Downloading ${file.name} from iCloud…`);
      try {
        const downloadedFiles = await library.download([file.id]);
        const downloadedFile = downloadedFiles.find((item) => item.id === file.id);
        if (!downloadedFile) return;
        setNotice(null);
        if (playAfterDownload) await playbackRef.current?.play(downloadedFile);
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
      if (file.downloadState === 'inCloud') {
        Alert.alert(
          'Added to Queue',
          'This file is only in iCloud. Download it now, or wait until Playr reaches it?',
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Download', onPress: () => void downloadAndMaybePlay(file, false) },
          ],
        );
      } else {
        setNotice(`${file.name} was added to the queue.`);
      }
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

  const downloadedIds = library.files
    .filter((file) => file.downloadState === 'downloaded')
    .map((file) => file.id);

  const confirmRemoveAllDownloads = useCallback(() => {
    Alert.alert(
      'Remove All Downloads?',
      'This removes local copies only. The files remain in iCloud Drive.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove Downloads',
          style: 'destructive',
          onPress: () => void removeFileDownloads(downloadedIds),
        },
      ],
    );
  }, [downloadedIds, removeFileDownloads]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const finishSelecting = useCallback(() => {
    setIsSelecting(false);
    setSelectedIds(new Set());
  }, []);

  const downloadSelected = useCallback(async () => {
    const ids = [...selectedIds].filter(
      (id) => library.files.find((file) => file.id === id)?.downloadState === 'inCloud',
    );
    if (ids.length > 0) await library.download(ids);
    finishSelecting();
  }, [finishSelecting, library.download, library.files, selectedIds]);

  const removeSelected = useCallback(async () => {
    const ids = [...selectedIds].filter(
      (id) => library.files.find((file) => file.id === id)?.downloadState === 'downloaded',
    );
    if (ids.length > 0) await removeFileDownloads(ids);
    finishSelecting();
  }, [finishSelecting, library.files, removeFileDownloads, selectedIds]);

  const banner = library.error ?? notice;

  const renderScreen = (targetScreen: Screen) => {
    const visibleFiles = targetScreen === 'library'
      ? library.files
      : library.queueIds
          .map((id) => library.files.find((file) => file.id === id))
          .filter((file): file is ICloudAudioFile => file != null);

    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
        <FlatList
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: playback.currentFile ? 116 : 30 },
          ]}
          data={visibleFiles}
          keyExtractor={(file) => file.id}
          ListHeaderComponent={
            <View>
              <View style={styles.headerRow}>
                <View style={styles.titleRow}>
                  <Text style={[styles.largeTitle, { color: palette.label }]}>
                    {targetScreen === 'library' ? 'Audio' : 'Queue'}
                  </Text>
                  {library.isRefreshing ? (
                    <ActivityIndicator color={palette.secondaryLabel} />
                  ) : null}
                </View>

                {targetScreen === 'library' ? (
                  <Host
                    colorScheme={isDark ? 'dark' : 'light'}
                    ignoreSafeArea="all"
                    matchContents
                    seedColor={palette.label}
                    style={styles.nativeActionHost}
                  >
                    {isSelecting ? (
                      <Button
                        label="Done selecting"
                        systemImage="checkmark"
                        onPress={finishSelecting}
                        modifiers={[
                          buttonStyle('glass'),
                          buttonBorderShape('circle'),
                          controlSize('large'),
                          labelStyle('iconOnly'),
                          foregroundStyle(palette.label),
                        ]}
                      />
                    ) : (
                      <Menu
                        label="Library actions"
                        systemImage="ellipsis"
                        modifiers={[
                          buttonStyle('glass'),
                          buttonBorderShape('circle'),
                          controlSize('large'),
                          labelStyle('iconOnly'),
                          menuIndicator('hidden'),
                          menuOrder('fixed'),
                          foregroundStyle(palette.label),
                        ]}
                      >
                        <Button
                          label="Select Files"
                          systemImage="checkmark.circle"
                          onPress={() => setIsSelecting(true)}
                        />
                        <Button
                          label="Remove All Downloads"
                          systemImage="trash"
                          role="destructive"
                          modifiers={[disabled(downloadedIds.length === 0)]}
                          onPress={confirmRemoveAllDownloads}
                        />
                        <Button
                          label="Refresh"
                          systemImage="arrow.clockwise"
                          onPress={() => void library.refresh()}
                        />
                      </Menu>
                    )}
                  </Host>
                ) : library.queueIds.length > 0 ? (
                  <Pressable onPress={() => void library.clearQueue()}>
                    <Text style={[styles.clearButton, { color: palette.destructive }]}>Clear</Text>
                  </Pressable>
                ) : null}
              </View>

              {banner ? (
                <Pressable
                  onPress={() => {
                    library.clearError();
                    setNotice(null);
                  }}
                  style={[styles.banner, { backgroundColor: palette.fill }]}
                >
                  <Text style={[styles.bannerText, { color: palette.secondaryLabel }]}>{banner}</Text>
                  <Icon name="xmark" color={palette.secondaryLabel} size={12} />
                </Pressable>
              ) : null}

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
              ) : null}
            </View>
          }
          ListEmptyComponent={
            library.isLoading ? (
              <ActivityIndicator color={palette.accent} style={styles.loading} />
            ) : library.availability === 'available' ? (
              <EmptyState palette={palette} screen={targetScreen} />
            ) : null
          }
          refreshControl={
            <RefreshControl
              onRefresh={library.refresh}
              refreshing={library.isRefreshing}
              tintColor={palette.secondaryLabel}
            />
          }
          renderItem={({ item }) => (
            <View style={{ backgroundColor: palette.surface }}>
              <EpisodeRow
                file={item}
                isCurrent={playback.currentFile?.id === item.id}
                isPlaying={playback.status.playing}
                isQueue={targetScreen === 'queue'}
                isSelected={selectedIds.has(item.id)}
                isSelecting={isSelecting && targetScreen === 'library'}
                onAddToQueue={() => void addFileToQueue(item)}
                onDownload={() => void downloadAndMaybePlay(item, false)}
                onPress={() => void openFile(item)}
                onRemoveDownload={() => void removeFileDownloads([item.id])}
                onRemoveFromQueue={() => void library.removeFromQueue(item.id)}
                onToggleSelection={() => toggleSelection(item.id)}
                palette={palette}
                progress={library.progressById.get(item.id)}
              />
            </View>
          )}
          ItemSeparatorComponent={() => (
            <View style={[styles.separator, { backgroundColor: palette.separator }]} />
          )}
        />

        {targetScreen === 'library' && isSelecting && selectedIds.size > 0 ? (
          <GlassPanel
            interactive
            palette={palette}
            style={[styles.selectionBar, { bottom: playback.currentFile ? 102 : 18 }]}
          >
            <Pressable onPress={() => void downloadSelected()} style={styles.batchAction}>
              <Icon name="icloud.and.arrow.down" color={palette.accent} size={20} />
              <Text style={[styles.batchText, { color: palette.accent }]}>Download</Text>
            </Pressable>
            <View style={[styles.verticalSeparator, { backgroundColor: palette.separator }]} />
            <Pressable onPress={() => void removeSelected()} style={styles.batchAction}>
              <Icon name="trash" color={palette.destructive} size={19} />
              <Text style={[styles.batchText, { color: palette.destructive }]}>Remove</Text>
            </Pressable>
          </GlassPanel>
        ) : null}

        {playback.currentFile ? (
          <Pressable onPress={() => setIsPlayerOpen(true)} style={styles.miniPlayerPosition}>
            <GlassPanel interactive palette={palette} style={styles.miniPlayer}>
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
              <Pressable
                accessibilityLabel={playback.status.playing ? 'Pause' : 'Play'}
                hitSlop={10}
                onPress={(event) => {
                  event.stopPropagation();
                  playback.toggle();
                }}
                style={styles.miniControl}
              >
                <Icon
                  name={playback.status.playing ? 'pause.fill' : 'play.fill'}
                  color={palette.label}
                  size={23}
                />
              </Pressable>
            </GlassPanel>
          </Pressable>
        ) : null}
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
            if (selection !== 'library' && selection !== 'queue') return;
            setScreen(selection);
            if (selection === 'queue') finishSelecting();
          }}
          modifiers={[tabViewStyle({ type: 'automatic' })]}
        >
          <TabView.Tab value="library" label="Library" systemImage="music.note.list">
            <RNHostView>{renderScreen('library')}</RNHostView>
          </TabView.Tab>
          <TabView.Tab value="queue" label="Queue" systemImage="text.badge.plus">
            <RNHostView>{renderScreen('queue')}</RNHostView>
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
  listContent: { paddingHorizontal: 16 },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 18,
    paddingTop: 12,
  },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: 0.2 },
  nativeActionHost: { minHeight: 44, minWidth: 44 },
  banner: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18 },
  clearButton: { fontSize: 15, fontWeight: '500' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 64 },
  loading: { marginTop: 56 },
  emptyState: { alignItems: 'center', paddingHorizontal: 34, paddingTop: 56 },
  icloudUnavailable: { alignItems: 'center', paddingHorizontal: 28, paddingTop: 46 },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: 13, textAlign: 'center' },
  emptyBody: { fontSize: 14, lineHeight: 20, marginTop: 7, textAlign: 'center' },
  miniPlayerPosition: { bottom: 12, left: 12, position: 'absolute', right: 12 },
  miniPlayer: {
    alignItems: 'center',
    borderRadius: 22,
    flexDirection: 'row',
    height: 78,
    paddingHorizontal: 10,
  },
  miniArtwork: {
    alignItems: 'center',
    borderRadius: 14,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  miniText: { flex: 1, marginLeft: 11 },
  miniTitle: { fontSize: 15, fontWeight: '600' },
  miniDetail: { fontSize: 12, marginTop: 3 },
  miniControl: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  selectionBar: {
    alignSelf: 'center',
    borderRadius: 22,
    flexDirection: 'row',
    left: 32,
    overflow: 'hidden',
    position: 'absolute',
    right: 32,
  },
  batchAction: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 52,
  },
  batchText: { fontSize: 14, fontWeight: '600' },
  verticalSeparator: {
    alignSelf: 'stretch',
    marginVertical: 10,
    width: StyleSheet.hairlineWidth,
  },
});
