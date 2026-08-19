import { NativeModule, registerWebModule } from 'expo';

import type {
  ICloudAudioFile,
  ICloudAvailability,
  ICloudFileOperationResult,
} from './PlayrICloud.types';

// PlayrICloudModule is not available on the web platform.
class PlayrICloudModule extends NativeModule<{}> {
  async getAvailabilityAsync(): Promise<ICloudAvailability> {
    return 'unavailable';
  }

  async ensureLibraryAsync(): Promise<void> {
    throw new Error('The Playr iCloud library is only available on iOS.');
  }

  async listAudioFilesAsync(): Promise<ICloudAudioFile[]> {
    return [];
  }

  async getAudioFilesAsync(_ids: string[]): Promise<ICloudAudioFile[]> {
    return [];
  }

  async requestDownloadsAsync(_ids: string[]): Promise<ICloudFileOperationResult[]> {
    return [];
  }

  async removeDownloadsAsync(_ids: string[]): Promise<ICloudFileOperationResult[]> {
    return [];
  }
}

export default registerWebModule(PlayrICloudModule, 'PlayrICloudModule');
