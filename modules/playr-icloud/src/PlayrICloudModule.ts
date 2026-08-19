import { NativeModule, requireNativeModule } from 'expo';

import type {
  ICloudAudioFile,
  ICloudAvailability,
  ICloudFileOperationResult,
} from './PlayrICloud.types';

declare class PlayrICloudModule extends NativeModule<{}> {
  getAvailabilityAsync(): Promise<ICloudAvailability>;
  ensureLibraryAsync(): Promise<void>;
  listAudioFilesAsync(): Promise<ICloudAudioFile[]>;
  getAudioFilesAsync(ids: string[]): Promise<ICloudAudioFile[]>;
  requestDownloadsAsync(ids: string[]): Promise<ICloudFileOperationResult[]>;
  removeDownloadsAsync(ids: string[]): Promise<ICloudFileOperationResult[]>;
}

export default requireNativeModule<PlayrICloudModule>('PlayrICloud');
