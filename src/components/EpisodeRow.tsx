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

function fileDetail(file: ICloudAudioFile, progress?: PlaybackProgress, isRemoving = false) {
  if (isRemoving) return 'Removing download';
  if (file.downloadState === 'downloading') {
    return file.downloadProgress == null
      ? 'Downloading from iCloud'
      : `Downloading ${Math.round(file.downloadProgress * 100)}%`;
  }
  if (progress?.completedAt) return 'Played';
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
  isRemoving,
  contextLabel,
  onPress,
  onToggleSelection,
}: {
  file: ICloudAudioFile;
  progress?: PlaybackProgress;
  palette: Palette;
  isCurrent: boolean;
  isPlaying: boolean;
  isSelecting: boolean;
  isSelected: boolean;
  isRemoving: boolean;
  contextLabel?: string;
  onPress: () => void;
  onToggleSelection: () => void;
}) {
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
      disabled={isRemoving}
      onPress={isSelecting ? onToggleSelection : onPress}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.62 : 1 }]}
    >
      {isSelecting ? (
        <View style={styles.selectionIcon}>
          <Icon
            name={isSelected ? 'checkmark.circle.fill' : 'circle'}
            color={isSelected ? palette.label : palette.tertiaryLabel}
            size={24}
          />
        </View>
      ) : (
        <View
          style={[styles.rowAction, { backgroundColor: palette.fill }]}
        >
          {file.downloadState === 'downloading' || isRemoving ? (
            <ActivityIndicator color={palette.label} size="small" />
          ) : (
            <Icon name={actionName} color={palette.label} size={19} />
          )}
        </View>
      )}

      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: palette.label }]}>
          {file.name}
        </Text>
        <Text numberOfLines={1} style={[styles.rowDetail, { color: palette.secondaryLabel }]}>
          {contextLabel ? `${contextLabel} · ` : ''}{fileDetail(file, progress, isRemoving)}
        </Text>
      </View>

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
    borderRadius: 999,
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
});
