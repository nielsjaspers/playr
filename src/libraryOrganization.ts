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

function orderIndex(order: string[], key: string) {
  const index = order.indexOf(key);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

export function orderFiles(
  files: ICloudAudioFile[],
  parentPath: string,
  order: LibraryOrder,
  reversed: boolean,
) {
  const storedOrder = order.get(parentPath) ?? [];
  const ordered = [...files].sort(
    (left, right) =>
      orderIndex(storedOrder, fileOrderKey(left)) - orderIndex(storedOrder, fileOrderKey(right)),
  );
  return reversed ? ordered.reverse() : ordered;
}

export function orderFolders(
  folders: ICloudFolder[],
  parentPath: string,
  order: LibraryOrder,
  reversed: boolean,
) {
  const storedOrder = order.get(parentPath) ?? [];
  const ordered = [...folders].sort(
    (left, right) =>
      orderIndex(storedOrder, folderOrderKey(left)) - orderIndex(storedOrder, folderOrderKey(right)),
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
  foldersWithoutRememberedTimestamps: Set<string> = new Set(),
) {
  return files
    .filter((file) => {
      if (foldersWithoutRememberedTimestamps.has(parentFolderPath(file.relativePath))) return false;
      const progress = progressById.get(file.id);
      return progress != null && progress.position > 0 && progress.completedAt == null;
    })
    .sort(
      (left, right) =>
        (progressById.get(right.id)?.updatedAt ?? 0) -
        (progressById.get(left.id)?.updatedAt ?? 0),
    );
}
