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
  metadataAvailable: boolean;
};

export type ICloudFolder = {
  id: string;
  name: string;
  relativePath: string;
};

export type ICloudFileOperationResult = {
  id: string;
  succeeded: boolean;
  error: string | null;
  errorDomain: string | null;
  errorCode: number | null;
  retryable: boolean;
};

export type ICloudLibrarySnapshot = {
  files: ICloudAudioFile[];
  folders: ICloudFolder[];
  complete: boolean;
  documentsUri: string;
};
