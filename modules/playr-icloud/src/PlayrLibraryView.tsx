import { requireNativeViewManager } from 'expo-modules-core';
import type { ComponentType } from 'react';
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';

import type { ICloudAudioFile, ICloudFolder } from './PlayrICloud.types';

export type PlayrLibraryAudioItem = Pick<
  ICloudAudioFile,
  'id' | 'name' | 'relativePath' | 'size' | 'downloadState' | 'downloadProgress'
> & {
  progressPosition: number | null;
  progressDuration: number | null;
  completedAt: number | null;
  contextLabel: string | null;
};

type IdEvent = NativeSyntheticEvent<{ id: string }>;
type IdsEvent = NativeSyntheticEvent<{ ids: string[] }>;
type PathEvent = NativeSyntheticEvent<{ path: string }>;
type MoveEvent = NativeSyntheticEvent<{
  ids: string[];
  destinationFolderPath: string;
}>;
type QueryEvent = NativeSyntheticEvent<{ query: string }>;
type SearchScopeEvent = NativeSyntheticEvent<{ global: boolean }>;

export type PlayrLibraryViewProps = {
  style?: StyleProp<ViewStyle>;
  title: string;
  currentFolderPath: string;
  searchQuery: string;
  searchGlobally: boolean;
  isRefreshing: boolean;
  isReversed: boolean;
  currentFileId: string | null;
  isPlaying: boolean;
  removingIds: string[];
  queuedIds: string[];
  directFiles: PlayrLibraryAudioItem[];
  continueFiles: PlayrLibraryAudioItem[];
  searchResults: PlayrLibraryAudioItem[];
  folders: ICloudFolder[];
  onBack: () => void;
  onOpenFile: (event: IdEvent) => void;
  onAddToQueue: (event: IdEvent) => void;
  onRemoveDownloads: (event: IdsEvent) => void;
  onDownloadFiles: (event: IdsEvent) => void;
  onMoveFiles: (event: MoveEvent) => void;
  onReorderFiles: (event: IdsEvent) => void;
  onOpenFolder: (event: PathEvent) => void;
  onCreateFolder: () => void;
  onRenameFolder: () => void;
  onRemoveAllDownloads: () => void;
  onRefresh: () => void;
  onToggleOrder: () => void;
  onSearchChange: (event: QueryEvent) => void;
  onSearchScopeChange: (event: SearchScopeEvent) => void;
};

const NativePlayrLibraryView: ComponentType<PlayrLibraryViewProps> =
  requireNativeViewManager('PlayrICloud', 'PlayrLibraryView');

export function PlayrLibraryView(props: PlayrLibraryViewProps) {
  return <NativePlayrLibraryView {...props} />;
}
