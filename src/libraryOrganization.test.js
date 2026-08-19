import { describe, expect, test } from 'bun:test';

import {
  buildItemsByParent,
  getContinueListeningFiles,
  orderFiles,
  parentFolderPath,
  reconcileLibraryOrder,
  reorderFolderFiles,
  remapLibraryOrderPaths,
  searchAudioTitles,
} from './libraryOrganization';

const file = (relativePath) => ({
  id: relativePath,
  name: relativePath.split('/').at(-1).replace(/\.mp3$/, ''),
  relativePath,
  size: 1,
  modifiedAt: null,
  downloadState: 'inCloud',
  downloadProgress: null,
  localUri: null,
  isUploaded: true,
  metadataAvailable: true,
});

describe('library organization', () => {
  test('derives a direct parent path', () => {
    expect(parentFolderPath('Podcasts/Show/Episode.mp3')).toBe('Podcasts/Show');
    expect(parentFolderPath('Episode.mp3')).toBe('');
  });

  test('keeps stored order and appends a newly discovered file', () => {
    const files = [file('one.mp3'), file('two.mp3'), file('three.mp3')];
    const items = buildItemsByParent(files, []);
    const stored = new Map([['', ['file:two.mp3', 'file:one.mp3']]]);
    const reconciled = reconcileLibraryOrder(stored, items);

    expect(orderFiles(files, '', reconciled, false).map((item) => item.id)).toEqual([
      'two.mp3',
      'one.mp3',
      'three.mp3',
    ]);
    expect(orderFiles(files, '', reconciled, true).map((item) => item.id)).toEqual([
      'three.mp3',
      'one.mp3',
      'two.mp3',
    ]);
  });

  test('searches the current folder subtree or the entire library', () => {
    const files = [file('Shows/Alpha.mp3'), file('Music/Alpha Live.mp3')];
    expect(searchAudioTitles(files, 'alpha', 'Shows', false).map((item) => item.id)).toEqual([
      'Shows/Alpha.mp3',
    ]);
    expect(searchAudioTitles(files, 'alpha', 'Shows', true)).toHaveLength(2);
  });

  test('keeps manual order when a folder is renamed', () => {
    const order = new Map([
      ['', ['folder:Shows']],
      ['Shows', ['file:Shows/two.mp3', 'file:Shows/one.mp3']],
    ]);
    expect([...remapLibraryOrderPaths(order, 'Shows', 'Podcasts')]).toEqual([
      ['', ['folder:Podcasts']],
      ['Podcasts', ['file:Podcasts/two.mp3', 'file:Podcasts/one.mp3']],
    ]);
  });

  test('reorders files without moving folders and stores reversed display order correctly', () => {
    const order = new Map([
      ['', ['file:one.mp3', 'folder:Shows', 'file:two.mp3']],
    ]);
    expect(reorderFolderFiles(order, '', ['two.mp3', 'one.mp3'], false).get('')).toEqual([
      'file:two.mp3',
      'folder:Shows',
      'file:one.mp3',
    ]);
    expect(reorderFolderFiles(order, '', ['one.mp3', 'two.mp3'], true).get('')).toEqual([
      'file:two.mp3',
      'folder:Shows',
      'file:one.mp3',
    ]);
  });

  test('continue listening excludes unplayed and completed files', () => {
    const files = [file('active.mp3'), file('done.mp3'), file('new.mp3')];
    const progress = new Map([
      ['active.mp3', { fileId: 'active.mp3', position: 10, duration: 100, completedAt: null, updatedAt: 2 }],
      ['done.mp3', { fileId: 'done.mp3', position: 100, duration: 100, completedAt: 1, updatedAt: 3 }],
    ]);
    expect(getContinueListeningFiles(files, progress).map((item) => item.id)).toEqual([
      'active.mp3',
    ]);
  });

  test('continue listening keeps only the latest item from each folder', () => {
    const olderTrack = file('music/older.mp3');
    const latestTrack = file('music/latest.mp3');
    const podcast = file('podcasts/episode.mp3');
    const progress = new Map([
      [olderTrack.id, { fileId: olderTrack.id, position: 12, duration: 100, completedAt: null, updatedAt: 1 }],
      [latestTrack.id, { fileId: latestTrack.id, position: 0, duration: 100, completedAt: null, updatedAt: 3 }],
      [podcast.id, { fileId: podcast.id, position: 20, duration: 100, completedAt: null, updatedAt: 2 }],
    ]);

    expect(
      getContinueListeningFiles([olderTrack, latestTrack, podcast], progress).map(
        (item) => item.id,
      ),
    ).toEqual([latestTrack.id, podcast.id]);
  });
});
