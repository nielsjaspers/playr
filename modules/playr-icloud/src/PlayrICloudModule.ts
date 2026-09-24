import { NativeModule, requireNativeModule } from 'expo';

import type {
  ICloudAudioFile,
  ICloudAvailability,
  ICloudFileOperationResult,
  ICloudFolder,
  ICloudLibrarySnapshot,
} from './PlayrICloud.types';

declare class PlayrICloudModule extends NativeModule<{}> {
  getAvailabilityAsync(): Promise<ICloudAvailability>;
  ensureLibraryAsync(): Promise<void>;
  scanLibraryAsync(): Promise<ICloudLibrarySnapshot>;
  getAudioFilesAsync(ids: string[]): Promise<ICloudAudioFile[]>;
  requestDownloadsAsync(ids: string[]): Promise<ICloudFileOperationResult[]>;
  removeDownloadsAsync(ids: string[]): Promise<ICloudFileOperationResult[]>;
  createFolderAsync(parentPath: string, name: string): Promise<ICloudFolder>;
  renameFolderAsync(relativePath: string, name: string): Promise<ICloudFolder>;
  moveAudioFileAsync(id: string, destinationFolderPath: string): Promise<ICloudAudioFile>;
}

export default requireNativeModule<PlayrICloudModule>('PlayrICloud');
