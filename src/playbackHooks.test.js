import { afterEach, expect, mock, test } from 'bun:test';
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
afterEach(async () => { if (root) await act(() => root.unmount()); root = null; alerts.length = 0; });

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
  return { get: () => result, library, errors, setQueue(ids) { queue = ids; library.queueIds = ids; } };
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
