import { requireNativeViewManager } from 'expo-modules-core';
import type { ComponentType } from 'react';
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';

import type { PlayrLibraryAudioItem } from './PlayrLibraryView';

type IdEvent = NativeSyntheticEvent<{ id: string }>;
type IdsEvent = NativeSyntheticEvent<{ ids: string[] }>;

export type PlayrQueueViewProps = {
  style?: StyleProp<ViewStyle>;
  currentFileId: string | null;
  isPlaying: boolean;
  files: PlayrLibraryAudioItem[];
  continuationFiles: PlayrLibraryAudioItem[];
  onOpenContinuation: (event: IdEvent) => void;
  onReorderContinuation: (event: IdsEvent) => void;
  onOpenFile: (event: IdEvent) => void;
  onRemoveFromQueue: (event: IdEvent) => void;
  onReorder: (event: IdsEvent) => void;
  onClear: () => void;
};

const NativePlayrQueueView: ComponentType<PlayrQueueViewProps> =
  requireNativeViewManager('PlayrICloud', 'PlayrQueueView');

export function PlayrQueueView(props: PlayrQueueViewProps) {
  return <NativePlayrQueueView {...props} />;
}
