export type ICloudAvailability = 'available' | 'signedOut' | 'unavailable';

export type ICloudDownloadState = 'downloaded' | 'downloading' | 'inCloud';

export type ICloudAudioFile = {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  modifiedAt: number | null;
  downloadState: ICloudDownloadState;
  downloadProgress: number | null;
  localUri: string | null;
  isUploaded: boolean;
};

export type ICloudFileOperationResult = {
  id: string;
  succeeded: boolean;
  error: string | null;
};
