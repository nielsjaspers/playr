import type { ComponentProps } from 'react';
import { Modal, SafeAreaView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { PlayrQueueView } from '../../modules/playr-icloud';
import { GlassIconButton, type Palette } from '../ui';
import type { usePlayback } from '../usePlayback';
import type { RepeatMode } from '../playbackSequence';
import { getPlayerLayout } from './playerLayout';

type PlaybackController = ReturnType<typeof usePlayback>;

export function PlayerModal({
  queueProps,
  isVisible,
  palette,
  playback,
  repeatMode,
  shuffleEnabled,
  onCycleRepeat,
  onToggleShuffle,
  onNext,
  onPrevious,
  onClose,
  pendingName,
  onCancelPending,
}: {
  queueProps: ComponentProps<typeof PlayrQueueView>;
  isVisible: boolean;
  palette: Palette;
  playback: PlaybackController;
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  onCycleRepeat: () => void;
  onToggleShuffle: () => void;
  onNext: () => Promise<boolean>;
  onPrevious: () => Promise<boolean>;
  onClose: () => void;
  pendingName: string | null;
  onCancelPending: () => void;
}) {
  const viewport = useWindowDimensions();
  const layout = getPlayerLayout(viewport.width, viewport.height);

  return (
    <Modal
      allowSwipeDismissal={false}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={isVisible && playback.currentFile != null}
    >
      <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <GlassIconButton label="Close player" name="chevron.down" onPress={onClose} palette={palette} />
          <Text style={[styles.headerTitle, { color: palette.secondaryLabel }]}>NOW PLAYING</Text>
          <View style={styles.headerSpacer} />
        </View>
        <PlayrQueueView
          {...queueProps}
          embedded
          repeatMode={repeatMode}
          player={{
            title: playback.currentFile?.name ?? '',
            currentTime: playback.status.currentTime,
            duration: playback.status.duration,
            artworkSize: layout.artworkSize,
            shuffleEnabled,
            pendingName,
          }}
          onSeek={({ nativeEvent }) => void playback.seekTo(nativeEvent.seconds)}
          onSkip={({ nativeEvent }) => void playback.skip(nativeEvent.seconds)}
          onTogglePlaying={() => void playback.toggle()}
          onNext={() => void onNext()}
          onPrevious={() => void onPrevious()}
          onCycleRepeat={onCycleRepeat}
          onToggleShuffle={onToggleShuffle}
          onCancelPending={onCancelPending}
          style={styles.screen}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    paddingTop: 16,
  },
  headerTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.9 },
  headerSpacer: { height: 44, width: 44 },
});
