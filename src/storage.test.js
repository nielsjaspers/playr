import { beforeEach, expect, mock, test } from 'bun:test';
import { Database } from 'bun:sqlite';

const sqlite = new Database(':memory:');
const adapter = {
  execAsync: async (sql) => sqlite.exec(sql),
  runAsync: async (sql, ...params) => sqlite.query(sql).run(...params),
  getAllAsync: async (sql, ...params) => sqlite.query(sql).all(...params),
  getFirstAsync: async (sql, ...params) => sqlite.query(sql).get(...params),
  withExclusiveTransactionAsync: async (task) => {
    sqlite.exec('BEGIN');
    try {
      await task(adapter);
      sqlite.exec('COMMIT');
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  },
};
mock.module('expo-sqlite', () => ({ openDatabaseAsync: async () => adapter }));
const storage = await import('./storage');

beforeEach(async () => {
  await storage.getFolderPreferences();
  sqlite.exec('DELETE FROM folder_preferences; DELETE FROM playback_progress; DELETE FROM queue_items; DELETE FROM library_order;');
});

test('renaming a folder to itself preserves its preferences and descendants', async () => {
  await storage.saveFolderKeepDownloads('Shows', true);
  await storage.saveFolderRememberTimestamps('Shows/Season', false);
  await storage.remapFolderPathPrefix('Shows', 'Shows');
  const preferences = await storage.getFolderPreferences();
  expect(preferences.get('Shows').keepDownloads).toBe(true);
  expect(preferences.get('Shows/Season').rememberTimestamps).toBe(false);
});

test('renaming an emoji folder preserves progress, queue order, and preferences', async () => {
  await storage.saveFolderOrderReversed('🎧', true);
  await storage.saveFolderKeepDownloads('🎧/Season', true);
  await storage.savePlaybackProgress({ fileId: '🎧/one.mp3', position: 60, duration: 900, completedAt: null, updatedAt: 1 });
  await storage.addToQueue('🎧/one.mp3');
  await storage.addToQueue('other.mp3');
  await storage.remapFolderPathPrefix('🎧', 'Podcasts');
  expect((await storage.getPlaybackProgress()).get('Podcasts/one.mp3')?.position).toBe(60);
  expect(await storage.getQueueIds()).toEqual(['Podcasts/one.mp3', 'other.mp3']);
  expect(await storage.getReversedFolderPaths()).toEqual(new Set(['Podcasts']));
  expect((await storage.getFolderPreferences()).get('Podcasts/Season')?.keepDownloads).toBe(true);
});
