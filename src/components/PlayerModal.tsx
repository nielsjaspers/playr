import { Modal, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';

import { GlassGroup, GlassIconButton, Icon, type Palette } from '../ui';
import type { usePlayback } from '../usePlayback';
import { formatDuration } from './EpisodeRow';

type PlaybackController = ReturnType<typeof usePlayback>;

export function PlayerModal({
  isVisible,
  palette,
  playback,
  onClose,
}: {
  isVisible: boolean;
  palette: Palette;
  playback: PlaybackController;
  onClose: () => void;
}) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={isVisible && playback.currentFile != null}
    >
      <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <GlassIconButton
            label="Close player"
            name="chevron.down"
            onPress={onClose}
            palette={palette}
          />
          <Text style={[styles.headerTitle, { color: palette.secondaryLabel }]}>NOW PLAYING</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={[styles.artwork, { backgroundColor: palette.surface }]}>
          <Icon name="waveform" color={palette.accent} size={92} weight="regular" />
        </View>

        <View style={styles.metadata}>
          <Text numberOfLines={2} style={[styles.title, { color: palette.label }]}>
            {playback.currentFile?.name}
          </Text>
          <Text style={[styles.subtitle, { color: palette.secondaryLabel }]}>iCloud Drive › Playr</Text>
        </View>

        <View style={styles.scrubberSection}>
          <Slider
            maximumTrackTintColor={palette.fill}
            maximumValue={Math.max(playback.status.duration, 1)}
            minimumTrackTintColor={palette.label}
            minimumValue={0}
            onSlidingComplete={(value) => void playback.seekTo(value)}
            thumbTintColor={palette.label}
            value={playback.status.currentTime}
          />
          <View style={styles.timeRow}>
            <Text style={[styles.timeText, { color: palette.secondaryLabel }]}>
              {formatDuration(playback.status.currentTime)}
            </Text>
            <Text style={[styles.timeText, { color: palette.secondaryLabel }]}>
              −{formatDuration(Math.max(0, playback.status.duration - playback.status.currentTime))}
            </Text>
          </View>
        </View>

        <GlassGroup spacing={18} style={styles.controls}>
          <GlassIconButton
            label="Back 15 seconds"
            name="gobackward.15"
            onPress={() => void playback.skip(-15)}
            palette={palette}
            size={58}
          />
          <GlassIconButton
            label={playback.status.playing ? 'Pause' : 'Play'}
            name={playback.status.playing ? 'pause.fill' : 'play.fill'}
            onPress={playback.toggle}
            palette={palette}
            size={76}
          />
          <GlassIconButton
            label="Forward 30 seconds"
            name="goforward.30"
            onPress={() => void playback.skip(30)}
            palette={palette}
            size={58}
          />
        </GlassGroup>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 24,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  headerTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.9,
  },
  headerSpacer: {
    height: 44,
    width: 44,
  },
  artwork: {
    alignItems: 'center',
    alignSelf: 'center',
    aspectRatio: 1,
    borderRadius: 28,
    justifyContent: 'center',
    marginTop: 22,
    maxWidth: 390,
    width: '88%',
  },
  metadata: {
    marginTop: 28,
    paddingHorizontal: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 15,
    marginTop: 7,
  },
  scrubberSection: {
    marginTop: 24,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  timeText: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 26,
  },
});
