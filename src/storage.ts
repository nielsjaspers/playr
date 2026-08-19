import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import type { ICloudAudioFile } from '../modules/playr-icloud';

export type PlaybackProgress = {
  fileId: string;
  position: number;
  duration: number;
  completedAt: number | null;
  updatedAt: number;
};

export type FolderPreferences = {
  keepDownloads: boolean;
  rememberTimestamps: boolean;
};

type LibraryRow = {
  id: string;
  name: string;
  relative_path: string;
  size: number;
  modified_at: number | null;
  download_state: ICloudAudioFile['downloadState'];
  download_progress: number | null;
  local_uri: string | null;
  is_uploaded: number;
};

type ProgressRow = {
  file_id: string;
  position_seconds: number;
  duration_seconds: number;
  completed_at: number | null;
  updated_at: number;
};

type QueueRow = { file_id: string };

type OrderRow = {
  parent_path: string;
  item_key: string;
  position: number;
};

type FolderPreferenceRow = {
  parent_path: string;
  is_reversed: number;
  keep_downloads: number;
  remember_timestamps: number;
};

let databasePromise: Promise<SQLiteDatabase> | null = null;

async function getDatabase() {
  if (!databasePromise) {
    databasePromise = openDatabaseAsync('playr.db').then(async (database) => {
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS library_items (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          relative_path TEXT NOT NULL,
          size INTEGER NOT NULL,
          modified_at INTEGER,
          download_state TEXT NOT NULL,
          download_progress REAL,
          local_uri TEXT,
          is_uploaded INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS playback_progress (
          file_id TEXT PRIMARY KEY NOT NULL,
          position_seconds REAL NOT NULL,
          duration_seconds REAL NOT NULL,
          completed_at INTEGER,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS playback_progress_completed_at
          ON playback_progress(completed_at);

        CREATE TABLE IF NOT EXISTS queue_items (
          file_id TEXT PRIMARY KEY NOT NULL,
          position INTEGER NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS library_order (
          parent_path TEXT NOT NULL,
          item_key TEXT NOT NULL,
          position INTEGER NOT NULL,
          PRIMARY KEY (parent_path, item_key),
          UNIQUE (parent_path, position)
        );

        CREATE TABLE IF NOT EXISTS folder_preferences (
          parent_path TEXT PRIMARY KEY NOT NULL,
          is_reversed INTEGER NOT NULL DEFAULT 0,
          keep_downloads INTEGER NOT NULL DEFAULT 0,
          remember_timestamps INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS app_preferences (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
      `);

      const folderPreferenceColumns = await database.getAllAsync<{ name: string }>(
        'PRAGMA table_info(folder_preferences)',
      );
      const columnNames = new Set(folderPreferenceColumns.map((column) => column.name));
      if (!columnNames.has('keep_downloads')) {
        await database.execAsync(
          'ALTER TABLE folder_preferences ADD COLUMN keep_downloads INTEGER NOT NULL DEFAULT 0',
        );
      }
      if (!columnNames.has('remember_timestamps')) {
        await database.execAsync(
          'ALTER TABLE folder_preferences ADD COLUMN remember_timestamps INTEGER NOT NULL DEFAULT 1',
        );
      }
      return database;
    });
  }

  return databasePromise;
}

export async function getCachedLibrary(): Promise<ICloudAudioFile[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<LibraryRow>(
    'SELECT * FROM library_items ORDER BY modified_at DESC, name COLLATE NOCASE ASC',
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    relativePath: row.relative_path,
    size: row.size,
    modifiedAt: row.modified_at,
    downloadState: row.download_state,
    downloadProgress: row.download_progress,
    localUri: row.local_uri,
    isUploaded: row.is_uploaded === 1,
    metadataAvailable: true,
  }));
}

export async function replaceLibraryCache(files: ICloudAudioFile[]) {
  const database = await getDatabase();

  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync('DELETE FROM library_items');
    for (const file of files) {
      await transaction.runAsync(
        `INSERT INTO library_items (
          id, name, relative_path, size, modified_at, download_state,
          download_progress, local_uri, is_uploaded
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        file.id,
        file.name,
        file.relativePath,
        file.size,
        file.modifiedAt,
        file.downloadState,
        file.downloadProgress,
        file.localUri,
        file.isUploaded ? 1 : 0,
      );
    }
  });
}

export async function getPlaybackProgress(): Promise<Map<string, PlaybackProgress>> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<ProgressRow>('SELECT * FROM playback_progress');

  return new Map(
    rows.map((row) => [
      row.file_id,
      {
        fileId: row.file_id,
        position: row.position_seconds,
        duration: row.duration_seconds,
        completedAt: row.completed_at,
        updatedAt: row.updated_at,
      },
    ]),
  );
}

export async function savePlaybackProgress(progress: PlaybackProgress) {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT INTO playback_progress (
      file_id, position_seconds, duration_seconds, completed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(file_id) DO UPDATE SET
      position_seconds = excluded.position_seconds,
      duration_seconds = excluded.duration_seconds,
      completed_at = excluded.completed_at,
      updated_at = excluded.updated_at`,
    progress.fileId,
    progress.position,
    progress.duration,
    progress.completedAt,
    progress.updatedAt,
  );
}

export async function getOverdueCompletedIds(cutoff: number) {
  const database = await getDatabase();
  const rows = await database.getAllAsync<{ file_id: string }>(
    `SELECT file_id
      FROM playback_progress
      WHERE completed_at IS NOT NULL AND completed_at < ?`,
    cutoff,
  );
  return rows.map((row) => row.file_id);
}

export async function getQueueIds() {
  const database = await getDatabase();
  const rows = await database.getAllAsync<QueueRow>(
    'SELECT file_id FROM queue_items ORDER BY position ASC',
  );
  return rows.map((row) => row.file_id);
}

export async function addToQueue(fileId: string) {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT OR IGNORE INTO queue_items (file_id, position)
      VALUES (?, COALESCE((SELECT MAX(position) + 1 FROM queue_items), 0))`,
    fileId,
  );
}

export async function removeFromQueue(fileId: string) {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM queue_items WHERE file_id = ?', fileId);
}

export async function clearQueue() {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM queue_items');
}

export async function replaceQueue(fileIds: string[]) {
  const database = await getDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync('DELETE FROM queue_items');
    for (const [position, fileId] of fileIds.entries()) {
      await transaction.runAsync(
        'INSERT INTO queue_items (file_id, position) VALUES (?, ?)',
        fileId,
        position,
      );
    }
  });
}

export async function getLibraryOrder() {
  const database = await getDatabase();
  const rows = await database.getAllAsync<OrderRow>(
    'SELECT * FROM library_order ORDER BY parent_path ASC, position ASC',
  );
  const order = new Map<string, string[]>();
  for (const row of rows) {
    order.set(row.parent_path, [...(order.get(row.parent_path) ?? []), row.item_key]);
  }
  return order;
}

export async function replaceLibraryOrder(order: Map<string, string[]>) {
  const database = await getDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync('DELETE FROM library_order');
    for (const [parentPath, itemKeys] of order) {
      for (const [position, itemKey] of itemKeys.entries()) {
        await transaction.runAsync(
          'INSERT INTO library_order (parent_path, item_key, position) VALUES (?, ?, ?)',
          parentPath,
          itemKey,
          position,
        );
      }
    }
  });
}

export async function getReversedFolderPaths() {
  const database = await getDatabase();
  const rows = await database.getAllAsync<{ parent_path: string }>(
    'SELECT parent_path FROM folder_preferences WHERE is_reversed = 1',
  );
  return new Set(rows.map((row) => row.parent_path));
}

export async function getFolderPreferences() {
  const database = await getDatabase();
  const rows = await database.getAllAsync<FolderPreferenceRow>(
    'SELECT * FROM folder_preferences',
  );
  return new Map<string, FolderPreferences>(
    rows.map((row) => [
      row.parent_path,
      {
        keepDownloads: row.keep_downloads === 1,
        rememberTimestamps: row.remember_timestamps === 1,
      },
    ]),
  );
}

export async function saveFolderKeepDownloads(parentPath: string, keepDownloads: boolean) {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT INTO folder_preferences (parent_path, keep_downloads) VALUES (?, ?)
      ON CONFLICT(parent_path) DO UPDATE SET keep_downloads = excluded.keep_downloads`,
    parentPath,
    keepDownloads ? 1 : 0,
  );
}

export async function saveFolderRememberTimestamps(
  parentPath: string,
  rememberTimestamps: boolean,
) {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT INTO folder_preferences (parent_path, remember_timestamps) VALUES (?, ?)
      ON CONFLICT(parent_path) DO UPDATE SET remember_timestamps = excluded.remember_timestamps`,
    parentPath,
    rememberTimestamps ? 1 : 0,
  );
}

export async function getAutoDownloadOnTap() {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_preferences WHERE key = 'auto_download_on_tap'`,
  );
  return row?.value === '1';
}

export async function saveAutoDownloadOnTap(enabled: boolean) {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT INTO app_preferences (key, value) VALUES ('auto_download_on_tap', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    enabled ? '1' : '0',
  );
}

export async function saveFolderOrderReversed(parentPath: string, reversed: boolean) {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT INTO folder_preferences (parent_path, is_reversed) VALUES (?, ?)
      ON CONFLICT(parent_path) DO UPDATE SET is_reversed = excluded.is_reversed`,
    parentPath,
    reversed ? 1 : 0,
  );
}

export async function replaceReversedFolderPaths(parentPaths: Set<string>) {
  const database = await getDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync('UPDATE folder_preferences SET is_reversed = 0');
    for (const parentPath of parentPaths) {
      await transaction.runAsync(
        `INSERT INTO folder_preferences (parent_path, is_reversed) VALUES (?, 1)
          ON CONFLICT(parent_path) DO UPDATE SET is_reversed = 1`,
        parentPath,
      );
    }
  });
}

export async function remapPlaybackFileId(oldId: string, newId: string) {
  const database = await getDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      'UPDATE OR REPLACE playback_progress SET file_id = ? WHERE file_id = ?',
      newId,
      oldId,
    );
    await transaction.runAsync(
      'UPDATE OR REPLACE queue_items SET file_id = ? WHERE file_id = ?',
      newId,
      oldId,
    );
  });
}

export async function remapFolderPathPrefix(oldPath: string, newPath: string) {
  const database = await getDatabase();
  const oldPrefix = `${oldPath}/`;
  const progressRows = await database.getAllAsync<{ file_id: string }>(
    'SELECT file_id FROM playback_progress WHERE file_id = ? OR substr(file_id, 1, ?) = ?',
    oldPath,
    oldPrefix.length,
    oldPrefix,
  );
  const queueRows = await database.getAllAsync<{ file_id: string }>(
    'SELECT file_id FROM queue_items WHERE file_id = ? OR substr(file_id, 1, ?) = ?',
    oldPath,
    oldPrefix.length,
    oldPrefix,
  );
  const preferenceRows = await database.getAllAsync<FolderPreferenceRow>(
    'SELECT * FROM folder_preferences WHERE parent_path = ? OR substr(parent_path, 1, ?) = ?',
    oldPath,
    oldPrefix.length,
    oldPrefix,
  );

  const remap = (path: string) =>
    path === oldPath ? newPath : `${newPath}/${path.slice(oldPrefix.length)}`;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    for (const row of progressRows) {
      await transaction.runAsync(
        'UPDATE OR REPLACE playback_progress SET file_id = ? WHERE file_id = ?',
        remap(row.file_id),
        row.file_id,
      );
    }
    for (const row of queueRows) {
      await transaction.runAsync(
        'UPDATE OR REPLACE queue_items SET file_id = ? WHERE file_id = ?',
        remap(row.file_id),
        row.file_id,
      );
    }
    for (const row of preferenceRows) {
      await transaction.runAsync(
        `INSERT OR REPLACE INTO folder_preferences (
          parent_path, is_reversed, keep_downloads, remember_timestamps
        ) VALUES (?, ?, ?, ?)`,
        remap(row.parent_path),
        row.is_reversed,
        row.keep_downloads,
        row.remember_timestamps,
      );
      await transaction.runAsync(
        'DELETE FROM folder_preferences WHERE parent_path = ?',
        row.parent_path,
      );
    }
  });
}
