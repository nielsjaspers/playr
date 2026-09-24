import { describe, expect, test } from 'bun:test';

import { mergeListedFiles, replaceVerifiedFiles } from './libraryFiles';

const downloaded = {
  id: 'episode.mp3',
  name: 'Episode',
  relativePath: 'episode.mp3',
  size: 50,
  modifiedAt: 1,
  downloadState: 'downloaded',
  downloadProgress: null,
  localUri: 'file:///episode.mp3',
  isUploaded: true,
  metadataAvailable: true,
};

const lockedFallback = {
  ...downloaded,
  size: 0,
  modifiedAt: null,
  downloadState: 'inCloud',
  localUri: null,
  metadataAvailable: false,
};

describe('mergeListedFiles', () => {
  test('keeps a listed episode visible while iCloud metadata is locked', () => {
    expect(mergeListedFiles([downloaded], [lockedFallback])).toEqual([downloaded]);
  });

  test('keeps an episode visible while File Provider transitions it to downloaded', () => {
    const downloading = {
      ...downloaded,
      downloadState: 'downloading',
      localUri: null,
    };

    expect(mergeListedFiles([downloading], [])).toEqual([downloading]);
  });
});

describe('replaceVerifiedFiles', () => {
  test('does not claim removal when iCloud cannot verify the new state', () => {
    expect(replaceVerifiedFiles([downloaded], [lockedFallback])).toEqual([downloaded]);
  });
});

test('an incomplete scan preserves absent downloaded files and unchanged verification preserves identity', () => {
  const original = { id: 'one', metadataAvailable: true, downloadState: 'downloaded', localUri: 'file://one' };
  const current = [original];
  expect(mergeListedFiles(current, [], false)).toEqual(current);
  expect(mergeListedFiles(current, [], true)).toEqual([]);
  expect(replaceVerifiedFiles(current, [{ ...original }])).toBe(current);
});
