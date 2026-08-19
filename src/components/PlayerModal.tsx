import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Host, Slider } from '@expo/ui/swift-ui';
import { controlSize, tint } from '@expo/ui/swift-ui/modifiers';

import { GlassIconButton, Icon, type Palette } from '../ui';
import type { usePlayback } from '../usePlayback';
import { formatDuration } from './EpisodeRow';
import { getPlayerLayout } from './playerLayout';

type PlaybackController = ReturnType<typeof usePlayback>;

function PlayerScrubber({
  currentTime,
  duration,
  palette,
  onSeek,
}: {
  currentTime: number;
  duration: number;
  palette: Palette;
  onSeek: (seconds: number) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftTime, setDraftTime] = useState(currentTime);
  const draftTimeRef = useRef(draftTime);
  const maximumValue = Math.max(duration, 1);

  useEffect(() => {
    if (isEditing) return;
    draftTimeRef.current = currentTime;
    setDraftTime(currentTime);
  }, [currentTime, isEditing]);

  return (
    <View style={styles.scrubberSection}>
      <Host seedColor={palette.label} style={styles.sliderHost}>
        <Slider
          max={maximumValue}
          min={0}
          modifiers={[controlSize('large'), tint(palette.label)]}
          onEditingChanged={(editing) => {
            setIsEditing(editing);
            if (!editing) void onSeek(draftTimeRef.current);
          }}
          onValueChange={(value) => {
            draftTimeRef.current = value;
            setDraftTime(value);
          }}
          value={Math.min(draftTime, maximumValue)}
        />
      </Host>
      <View style={styles.timeRow}>
        <Text style={[styles.timeText, { color: palette.secondaryLabel }]}>
          {formatDuration(draftTime)}
        </Text>
        <Text style={[styles.timeText, { color: palette.secondaryLabel }]}>
          −{formatDuration(Math.max(0, duration - draftTime))}
        </Text>
      </View>
    </View>
  );
}

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
  const viewport = useWindowDimensions();
  const layout = getPlayerLayout(viewport.width, viewport.height);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={isVisible && playback.currentFile != null}
    >
      <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.content}>
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

          <View style={styles.playerBody}>
            <View
              style={[
                styles.artwork,
                {
                  backgroundColor: palette.fill,
                  height: layout.artworkSize,
                  width: layout.artworkSize,
                },
              ]}
            >
              <Icon name="waveform" color={palette.accent} size={92} weight="regular" />
            </View>

            <View style={styles.metadata}>
              <Text numberOfLines={2} style={[styles.title, { color: palette.label }]}>
                {playback.currentFile?.name}
              </Text>
            </View>

            <PlayerScrubber
              currentTime={playback.status.currentTime}
              duration={playback.status.duration}
              onSeek={playback.seekTo}
              palette={palette}
            />

            <View style={styles.controls}>
              <GlassIconButton
                label="Back 15 seconds"
                name="gobackward.15"
                onPress={() => void playback.skip(-15)}
                palette={palette}
                size={52}
              />
              <GlassIconButton
                label={playback.status.playing ? 'Pause' : 'Play'}
                name={playback.status.playing ? 'pause.fill' : 'play.fill'}
                onPress={playback.toggle}
                palette={palette}
                size={64}
              />
              <GlassIconButton
                label="Forward 30 seconds"
                name="goforward.30"
                onPress={() => void playback.skip(30)}
                palette={palette}
                size={52}
              />
            </View>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: -8,
    paddingTop: 16,
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
  playerBody: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 20,
  },
  artwork: {
    alignItems: 'center',
    alignSelf: 'center',
    borderCurve: 'continuous',
    borderRadius: 26,
    justifyContent: 'center',
  },
  metadata: {
    marginTop: 24,
    paddingHorizontal: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  scrubberSection: {
    marginTop: 20,
  },
  sliderHost: {
    height: 44,
    width: '100%',
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
    gap: 32,
    justifyContent: 'center',
    marginTop: 24,
  },
});
