import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ICloudAudioFile } from '../../modules/playr-icloud';
import type { PlaybackProgress } from '../storage';
import { Icon, type Palette } from '../ui';

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  const remainder = wholeSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
    : `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

function formatSize(bytes: number) {
  if (bytes <= 0) return '';
  const megabytes = bytes / 1_048_576;
  return megabytes >= 1_024
    ? `${(megabytes / 1_024).toFixed(1)} GB`
    : `${Math.max(1, Math.round(megabytes))} MB`;
}

function fileDetail(file: ICloudAudioFile, progress?: PlaybackProgress) {
  if (file.downloadState === 'downloading') {
    return file.downloadProgress == null
      ? 'Downloading from iCloud'
      : `Downloading ${Math.round(file.downloadProgress * 100)}%`;
  }
  if (progress?.completedAt) return 'Played';
  if (progress && progress.position > 0) {
    return `${formatDuration(progress.position)} of ${formatDuration(progress.duration)}`;
  }
  const size = formatSize(file.size);
  if (file.downloadState === 'downloaded') return size || 'On this iPhone';
  return size ? `In iCloud · ${size}` : 'In iCloud';
}

export function EpisodeRow({
  file,
  progress,
  palette,
  isCurrent,
  isPlaying,
  isSelecting,
  isSelected,
  isQueue,
  onPress,
  onToggleSelection,
  onMore,
  onRemoveFromQueue,
}: {
  file: ICloudAudioFile;
  progress?: PlaybackProgress;
  palette: Palette;
  isCurrent: boolean;
  isPlaying: boolean;
  isSelecting: boolean;
  isSelected: boolean;
  isQueue: boolean;
  onPress: () => void;
  onToggleSelection: () => void;
  onMore: () => void;
  onRemoveFromQueue: () => void;
}) {
  const progressFraction = progress?.duration
    ? Math.min(1, progress.position / progress.duration)
    : 0;
  const actionName = file.downloadState === 'inCloud'
    ? 'icloud.and.arrow.down'
    : file.downloadState === 'downloading'
      ? 'arrow.down.circle'
      : isCurrent && isPlaying
        ? 'pause.fill'
        : 'play.fill';

  return (
    <Pressable
      accessibilityRole="button"
      onPress={isSelecting ? onToggleSelection : onPress}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.62 : 1 }]}
    >
      {isSelecting ? (
        <View style={styles.selectionIcon}>
          <Icon
            name={isSelected ? 'checkmark.circle.fill' : 'circle'}
            color={isSelected ? palette.accent : palette.tertiaryLabel}
            size={24}
          />
        </View>
      ) : (
        <Pressable
          accessibilityLabel={file.downloadState === 'inCloud' ? 'Download' : 'Play'}
          hitSlop={8}
          onPress={onPress}
          style={[styles.rowAction, { backgroundColor: palette.fill }]}
        >
          {file.downloadState === 'downloading' ? (
            <ActivityIndicator color={palette.accent} size="small" />
          ) : (
            <Icon name={actionName} color={palette.accent} size={19} />
          )}
        </Pressable>
      )}

      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: palette.label }]}>
          {file.name}
        </Text>
        <Text numberOfLines={1} style={[styles.rowDetail, { color: palette.secondaryLabel }]}>
          {fileDetail(file, progress)}
        </Text>
        {progressFraction > 0 && progressFraction < 1 ? (
          <View style={[styles.progressTrack, { backgroundColor: palette.fill }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: palette.accent, width: `${progressFraction * 100}%` },
              ]}
            />
          </View>
        ) : null}
      </View>

      {!isSelecting ? (
        <Pressable
          accessibilityLabel={isQueue ? 'Remove from queue' : 'More actions'}
          hitSlop={8}
          onPress={isQueue ? onRemoveFromQueue : onMore}
          style={styles.moreButton}
        >
          <Icon
            name={isQueue ? 'minus.circle' : 'ellipsis'}
            color={palette.secondaryLabel}
            size={20}
          />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 72,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  rowAction: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  selectionIcon: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  rowText: {
    flex: 1,
    marginLeft: 12,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.15,
  },
  rowDetail: {
    fontSize: 13,
    marginTop: 3,
  },
  progressTrack: {
    borderRadius: 2,
    height: 2,
    marginTop: 7,
    overflow: 'hidden',
    width: '100%',
  },
  progressFill: {
    height: '100%',
  },
  moreButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    marginLeft: 6,
    width: 34,
  },
});
