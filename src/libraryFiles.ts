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
  let changed = false;
  const next = currentFiles.map((file) => {
    const verified = verifiedById.get(file.id);
    if (!verified || sameFileMetadata(file, verified)) return file;
    changed = true;
    return verified;
  });
  return changed ? next : currentFiles;
}

export function sameFileMetadata(left: ICloudAudioFile, right: ICloudAudioFile) {
  return left.id === right.id && left.name === right.name && left.relativePath === right.relativePath &&
    left.size === right.size && left.modifiedAt === right.modifiedAt && left.downloadState === right.downloadState &&
    left.downloadProgress === right.downloadProgress && left.localUri === right.localUri &&
    left.isUploaded === right.isUploaded && left.metadataAvailable === right.metadataAvailable;
}
