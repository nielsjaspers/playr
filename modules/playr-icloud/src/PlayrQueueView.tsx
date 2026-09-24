import { requireNativeViewManager } from 'expo-modules-core';
import type { ComponentType } from 'react';
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';

import type { PlayrLibraryAudioItem } from './PlayrLibraryView';

type IdEvent = NativeSyntheticEvent<{ id: string }>;
type DropEvent = NativeSyntheticEvent<{ ids: string[]; beforeId: string | null; fromQueue: boolean }>;

export type PlayrQueueViewProps = {
  style?: StyleProp<ViewStyle>;
  embedded?: boolean;
  player?: {
    title: string;
    currentTime: number;
    duration: number;
    artworkSize: number;
    shuffleEnabled: boolean;
    pendingName: string | null;
  };
  onSeek?: (event: NativeSyntheticEvent<{ seconds: number }>) => void;
  onSkip?: (event: NativeSyntheticEvent<{ seconds: number }>) => void;
  onTogglePlaying?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onCycleRepeat?: () => void;
  onToggleShuffle?: () => void;
  onCancelPending?: () => void;
  repeatMode: 'off' | 'all' | 'one';
  currentFileId: string | null;
  isPlaying: boolean;
  files: PlayrLibraryAudioItem[];
  continuationFiles: PlayrLibraryAudioItem[];
  onOpenContinuation: (event: IdEvent) => void;
  onAddToQueue: (event: IdEvent) => void;
  onOpenFile: (event: IdEvent) => void;
  onRemoveFromQueue: (event: IdEvent) => void;
  onQueueDrop: (event: DropEvent) => void;
  onContinuationDrop: (event: DropEvent) => void;
  continuationAnchorId: string | null;
  onClear: () => void;
};

const NativePlayrQueueView: ComponentType<PlayrQueueViewProps> =
  requireNativeViewManager('PlayrICloud', 'PlayrQueueView');

export function PlayrQueueView(props: PlayrQueueViewProps) {
  return <NativePlayrQueueView {...props} />;
}
