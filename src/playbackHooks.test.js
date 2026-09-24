import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import React from 'react';
import { act, create } from 'react-test-renderer';

// Mount the production hooks; replace only the native boundary and iCloud I/O.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const alerts = [];
mock.module('react-native', () => ({
  Alert: { alert: (...args) => alerts.push(args) },
  AppState: { addEventListener: () => ({ remove() {} }) },
}));
const players = [];
const audioStatus = { isLoaded: true, playing: false, didJustFinish: false, currentTime: 0, duration: 100 };
mock.module('expo-audio', () => ({
  setAudioModeAsync: async () => {},
  useAudioPlayerStatus: () => audioStatus,
  createAudioPlayer: () => {
    const player = {
      source: null, played: [],
      replace(source) { this.source = source; },
      play() { this.played.push(this.source?.uri); },
      pause() {}, seekTo: async () => {},
      setActiveForLockScreen() {}, clearLockScreenControls() {}, release() {},
    };
    players.push(player);
    return player;
  },
}));
const { usePlayback } = await import('./usePlayback');
const { usePlaybackFlow } = await import('./usePlaybackFlow');
const file = (id, downloadState = 'downloaded') => ({
  id, name: id, relativePath: id, downloadState, localUri: downloadState === 'downloaded' ? `file://${id}` : null,
  size: 1, modifiedAt: null, downloadProgress: null, metadataAvailable: true, isUploaded: true,
});
const deferred = () => Promise.withResolvers();
let root;
afterEach(async () => { if (root) await act(() => root.unmount()); root = null; alerts.length = 0; Object.assign(audioStatus, { currentTime: 0, playing: false }); });

async function mount(overrides = {}) {
  const files = [file('A'), file('B'), file('C'), file('X')];
  let queue = [];
  const library = {
    files, queueIds: queue, progressById: new Map(), folderPreferencesByPath: new Map(),
    orderByFolder: new Map(), reversedFolderPaths: new Set(), autoDownloadOnTap: true,
    getQueueIds: () => queue,
    removeFromQueue: async (id) => { queue = queue.filter((item) => item !== id); },
    protectDownloads: () => {}, updateProgress: async () => {}, verifyFile: async (id) => files.find((file) => file.id === id),
    prepareFile: async (id) => files.find((file) => file.id === id),
    ...overrides,
  };
  const errors = [];
  let result;
  function Harness() {
    const playback = usePlayback({ progressById: library.progressById, onProgress: library.updateProgress,
      onFinished: () => {}, onError: (error) => errors.push(error) });
    const flow = usePlaybackFlow(library, playback, (error) => errors.push(error));
    result = { playback, flow };
    return null;
  }
  await act(() => { root = create(React.createElement(Harness)); });
  return { get: () => result, library, errors, render: () => act(() => root.update(React.createElement(Harness))), setQueue(ids) { queue = ids; library.queueIds = ids; } };
}

test('an old download cannot replace a newer library selection', async () => {
  const a = deferred();
  const app = await mount({ prepareFile: (id) => id === 'A' ? a.promise : Promise.resolve(file(id)) });
  await act(async () => app.get().flow.openLibraryFile(file('A')));
  await act(async () => app.get().flow.openLibraryFile(file('B')));
  expect(app.get().playback.currentFile.id).toBe('B');
  await act(async () => a.resolve(file('A')));
  expect(app.get().playback.currentFile.id).toBe('B');
  expect(players.at(-1).played).toEqual(['file://B']);
});

test('canceling a cloud prompt preserves the playing library and its continuation', async () => {
  const app = await mount({ autoDownloadOnTap: false, verifyFile: async (id) => file(id, id === 'X' ? 'inCloud' : 'downloaded') });
  await act(async () => app.get().flow.openLibraryFile(file('A')));
  await act(async () => app.get().flow.openLibraryFile(file('X', 'inCloud')));
  expect(alerts).toHaveLength(1);
  await act(async () => alerts[0][2][0].onPress());
  expect(app.get().playback.currentFile.id).toBe('A');
  expect(app.get().flow.session.libraryFileId).toBe('A');
  expect(app.get().flow.pending).toBeNull();
});

test('queued items play from the library without opening the queue tab, then continuation resumes', async () => {
  const app = await mount();
  await act(async () => app.get().flow.openLibraryFile(file('A')));
  app.setQueue(['X']);
  await act(async () => { await app.get().flow.navigate('next'); });
  expect(app.get().playback.currentFile.id).toBe('X');
  expect(app.library.getQueueIds()).toEqual([]);
  await act(async () => { await app.get().flow.navigate('next'); });
  expect(app.get().playback.currentFile.id).toBe('B');
});

test('stop invalidates a pending download and prevents a delayed restart', async () => {
  const pending = deferred();
  const app = await mount({ prepareFile: () => pending.promise });
  await act(async () => app.get().flow.openLibraryFile(file('A')));
  await act(async () => { await app.get().flow.stop(); });
  await act(async () => pending.resolve(file('A')));
  expect(app.get().playback.currentFile).toBeNull();
  expect(players.at(-1).played).toEqual([]);
});

test('a newer selection cancels a start waiting on persistence', async () => {
  const saving = deferred();
  const app = await mount({ updateProgress: () => saving.promise });
  await act(async () => { await app.get().playback.play(file('A')); });
  let b, c;
  await act(async () => { b = app.get().playback.play(file('B')); });
  await act(async () => { c = app.get().playback.play(file('C')); });
  await act(async () => { saving.resolve(); await Promise.all([b, c]); });
  expect(app.get().playback.currentFile.id).toBe('C');
  expect(players.at(-1).played).toEqual(['file://A', 'file://C']);
});

test('a replacement canceled during native seeking never starts or overwrites the next source', async () => {
  const seeking = deferred();
  const app = await mount({ progressById: new Map([['B', { fileId: 'B', position: 42, duration: 100, completedAt: null, updatedAt: 1 }]]) });
  await act(async () => { await app.get().playback.play(file('A')); });
  players.at(-1).seekTo = () => seeking.promise;
  let b, c;
  await act(async () => { b = app.get().playback.play(file('B')); });
  await act(async () => { c = app.get().playback.play(file('C')); });
  await act(async () => { seeking.resolve(); await Promise.all([b, c]); });
  expect(app.get().playback.currentFile.id).toBe('C');
  expect(players.at(-1).played).toEqual(['file://A', 'file://C']);
});

test('periodic progress saves resume five seconds after a backward seek', async () => {
  let now = 0;
  const clock = spyOn(performance, 'now').mockImplementation(() => now);
  const saves = [];
  try {
    const app = await mount({ updateProgress: async (progress) => saves.push(progress) });
    await act(async () => { await app.get().playback.play(file('A')); });
    Object.assign(audioStatus, { currentTime: 600, duration: 900, playing: true });
    now = 5000;
    await app.render();
    await act(async () => { await app.get().playback.seekTo(60); });
    expect(saves.at(-1).position).toBe(60);
    // A lock-screen seek also arrives as a status update, without calling seekTo.
    audioStatus.currentTime = 30;
    now = 10000;
    await app.render();
    expect(saves.at(-1).position).toBe(30);
    audioStatus.currentTime = 35;
    now = 15000;
    await app.render();
    expect(saves.at(-1).position).toBe(35);
  } finally { clock.mockRestore(); audioStatus.duration = 100; }
});

test('a failure to release the player stops callers from evicting its file', async () => {
  const app = await mount();
  await act(async () => { await app.get().playback.play(file('A')); });
  const player = players.at(-1);
  const pause = player.pause;
  player.pause = () => { throw new Error('Native player is busy'); };
  try {
    await act(async () => { await expect(app.get().flow.stop()).rejects.toThrow('could not release'); });
    expect(app.errors).toContain('Native player is busy');
  } finally { player.pause = pause; }
});

test('returning a queued episode updates both orders and survives later moves', async () => {
  const { moveItemsBefore } = await import('./queueOrder');
  const app = await mount({ moveQueueItems: async (ids, beforeId, fromQueue) => {
    app.setQueue(moveItemsBefore(app.library.getQueueIds(), ids, beforeId, !fromQueue));
  } });
  await act(async () => app.get().flow.openLibraryFile(file('A')));
  await act(async () => app.get().flow.queueContinuation(['B'], null));
  expect(app.get().flow.continuationIds).toEqual(['C', 'X']);
  await act(async () => app.get().flow.moveContinuation(['B'], 'C', true));
  await app.render();
  expect(app.library.getQueueIds()).toEqual([]);
  expect(app.get().flow.continuationIds).toEqual(['B', 'C', 'X']);
  await act(async () => app.get().flow.queueContinuation(['C'], null));
  await act(async () => app.get().flow.moveContinuation(['X'], 'B', false));
  await app.render();
  expect(app.library.getQueueIds()).toEqual(['C']);
  expect(app.get().flow.continuationIds).toEqual(['X', 'B']);
  await act(async () => app.get().flow.navigate('next'));
  expect(app.get().playback.currentFile.id).toBe('C');
  await act(async () => app.get().flow.navigate('next'));
  expect(app.get().playback.currentFile.id).toBe('X');
});
