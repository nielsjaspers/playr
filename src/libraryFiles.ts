import type { ICloudAudioFile } from '../modules/playr-icloud';

/** Keeps the last usable metadata when iCloud temporarily returns only a placeholder record. */
export function mergeListedFiles(
  currentFiles: ICloudAudioFile[],
  listedFiles: ICloudAudioFile[],
) {
  const currentById = new Map(currentFiles.map((file) => [file.id, file]));
  const listedIds = new Set(listedFiles.map((file) => file.id));
  const mergedFiles = listedFiles.map((file) =>
    file.metadataAvailable === false ? currentById.get(file.id) ?? file : file,
  );
  const transitioningFiles = currentFiles.filter(
    (file) => file.downloadState === 'downloading' && !listedIds.has(file.id),
  );
  return [...mergedFiles, ...transitioningFiles];
}

/** Replaces only files whose current iCloud metadata was read successfully. */
export function replaceVerifiedFiles(
  currentFiles: ICloudAudioFile[],
  verifiedFiles: ICloudAudioFile[],
) {
  const verifiedById = new Map(
    verifiedFiles
      .filter((file) => file.metadataAvailable !== false)
      .map((file) => [file.id, file]),
  );
  return currentFiles.map((file) => verifiedById.get(file.id) ?? file);
}
