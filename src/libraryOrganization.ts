import type { ICloudAudioFile, ICloudFolder } from '../modules/playr-icloud';
import type { PlaybackProgress } from './storage';

export const ROOT_FOLDER_PATH = '';

export type LibraryOrder = Map<string, string[]>;

export function parentFolderPath(relativePath: string) {
  const separatorIndex = relativePath.lastIndexOf('/');
  return separatorIndex < 0 ? ROOT_FOLDER_PATH : relativePath.slice(0, separatorIndex);
}

export function fileOrderKey(file: Pick<ICloudAudioFile, 'relativePath'>) {
  return `file:${file.relativePath}`;
}

export function folderOrderKey(folder: Pick<ICloudFolder, 'relativePath'>) {
  return `folder:${folder.relativePath}`;
}

export function buildItemsByParent(files: ICloudAudioFile[], folders: ICloudFolder[]) {
  const itemsByParent = new Map<string, string[]>();
  const append = (parentPath: string, itemKey: string) => {
    const current = itemsByParent.get(parentPath) ?? [];
    current.push(itemKey);
    itemsByParent.set(parentPath, current);
  };

  for (const folder of folders) {
    append(parentFolderPath(folder.relativePath), folderOrderKey(folder));
  }
  for (const file of files) {
    append(parentFolderPath(file.relativePath), fileOrderKey(file));
  }
  return itemsByParent;
}

/** Keeps existing positions and appends newly discovered iCloud items at the bottom. */
export function reconcileLibraryOrder(
  storedOrder: LibraryOrder,
  itemsByParent: Map<string, string[]>,
) {
  const reconciled = new Map<string, string[]>();
  for (const [parentPath, currentKeys] of itemsByParent) {
    const availableKeys = new Set(currentKeys);
    const existingKeys = (storedOrder.get(parentPath) ?? []).filter((key) => availableKeys.has(key));
    const existingSet = new Set(existingKeys);
    const newKeys = currentKeys.filter((key) => !existingSet.has(key));
    reconciled.set(parentPath, [...existingKeys, ...newKeys]);
  }
  return reconciled;
}

export function remapLibraryOrderPaths(
  order: LibraryOrder,
  oldPath: string,
  newPath: string,
) {
  const remapPath = (path: string) =>
    path === oldPath || path.startsWith(`${oldPath}/`)
      ? `${newPath}${path.slice(oldPath.length)}`
      : path;
  const remapKey = (key: string) => {
    const separatorIndex = key.indexOf(':');
    if (separatorIndex < 0) return key;
    const type = key.slice(0, separatorIndex + 1);
    return `${type}${remapPath(key.slice(separatorIndex + 1))}`;
  };
  return new Map(
    [...order].map(([parentPath, keys]) => [remapPath(parentPath), keys.map(remapKey)]),
  );
}

function orderRanks(order: string[]) {
  const ranks = new Map<string, number>();
  for (const [index, key] of order.entries()) {
    if (!ranks.has(key)) ranks.set(key, index);
  }
  return ranks;
}

export function orderFiles(
  files: ICloudAudioFile[],
  parentPath: string,
  order: LibraryOrder,
  reversed: boolean,
) {
  const ranks = orderRanks(order.get(parentPath) ?? []);
  const ordered = [...files].sort(
    (left, right) =>
      (ranks.get(fileOrderKey(left)) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(fileOrderKey(right)) ?? Number.MAX_SAFE_INTEGER),
  );
  return reversed ? ordered.reverse() : ordered;
}

export function orderFolders(
  folders: ICloudFolder[],
  parentPath: string,
  order: LibraryOrder,
  reversed: boolean,
) {
  const ranks = orderRanks(order.get(parentPath) ?? []);
  const ordered = [...folders].sort(
    (left, right) =>
      (ranks.get(folderOrderKey(left)) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(folderOrderKey(right)) ?? Number.MAX_SAFE_INTEGER),
  );
  return reversed ? ordered.reverse() : ordered;
}

/** Replaces only the file positions in a folder and leaves folder positions unchanged. */
export function reorderFolderFiles(
  order: LibraryOrder,
  parentPath: string,
  displayedFileIds: string[],
  reversed: boolean,
) {
  const storedFileKeys = (reversed ? [...displayedFileIds].reverse() : displayedFileIds).map(
    (id) => `file:${id}`,
  );
  const fileKeySet = new Set(storedFileKeys);
  let fileIndex = 0;
  const existingKeys = order.get(parentPath) ?? [];
  const nextKeys = existingKeys.map((key) => {
    if (!fileKeySet.has(key)) return key;
    const replacement = storedFileKeys[fileIndex];
    fileIndex += 1;
    return replacement;
  });
  nextKeys.push(...storedFileKeys.slice(fileIndex));

  const nextOrder = new Map(order);
  nextOrder.set(parentPath, nextKeys);
  return nextOrder;
}

export function isDirectChild(relativePath: string, parentPath: string) {
  return parentFolderPath(relativePath) === parentPath;
}

export function isInsideFolder(relativePath: string, folderPath: string) {
  return folderPath === ROOT_FOLDER_PATH || relativePath.startsWith(`${folderPath}/`);
}

export function searchAudioTitles(
  files: ICloudAudioFile[],
  query: string,
  folderPath: string,
  global: boolean,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];
  return files.filter(
    (file) =>
      (global || isInsideFolder(file.relativePath, folderPath)) &&
      file.name.toLocaleLowerCase().includes(normalizedQuery),
  );
}

export function getContinueListeningFiles(
  files: ICloudAudioFile[],
  progressById: Map<string, PlaybackProgress>,
) {
  const latestByFolder = new Map<string, ICloudAudioFile>();
  for (const file of files) {
    const progress = progressById.get(file.id);
    if (!progress || progress.completedAt != null) continue;

    const folderPath = parentFolderPath(file.relativePath);
    const current = latestByFolder.get(folderPath);
    if (
      !current ||
      progress.updatedAt > (progressById.get(current.id)?.updatedAt ?? 0)
    ) {
      latestByFolder.set(folderPath, file);
    }
  }

  return [...latestByFolder.values()]
    .sort(
      (left, right) =>
        (progressById.get(right.id)?.updatedAt ?? 0) -
        (progressById.get(left.id)?.updatedAt ?? 0),
    );
}
