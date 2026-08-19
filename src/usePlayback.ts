import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  createAudioPlayer,
  setAudioModeAsync,
  useAudioPlayerStatus,
} from 'expo-audio';

import type { ICloudAudioFile } from '../modules/playr-icloud';
import { releaseAudioPlayer } from './audioPlayerLifecycle';
import {
  advanceFinishGate,
  createFinishGate,
  resolveResumePosition,
  type FinishGate,
} from './playbackPolicy';
import type { PlaybackProgress } from './storage';

type PlayOptions = {
  rememberTimestamp?: boolean;
};

type PlaybackOptions = {
  progressById: Map<string, PlaybackProgress>;
  onProgress: (progress: PlaybackProgress) => Promise<void>;
  onFinished: (fileId: string) => void;
  onError: (message: string) => void;
};

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function createPlaybackPlayer() {
  return createAudioPlayer(null, {
    updateInterval: 250,
    keepAudioSessionActive: true,
  });
}

export function usePlayback({
  progressById,
  onProgress,
  onFinished,
  onError,
}: PlaybackOptions) {
  const [player, setPlayer] = useState(createPlaybackPlayer);
  const playerRef = useRef(player);
  const status = useAudioPlayerStatus(player);
  const [currentFile, setCurrentFile] = useState<ICloudAudioFile | null>(null);
  const currentFileRef = useRef(currentFile);
  const statusRef = useRef(status);
  const playingRef = useRef(status.playing);
  const completedAtRef = useRef<number | null>(null);
  const rememberTimestampRef = useRef(true);
  const lastSavedSecondRef = useRef(0);
  const finishGateRef = useRef<FinishGate | null>(null);
  const onFinishedRef = useRef(onFinished);

  useEffect(() => {
    currentFileRef.current = currentFile;
  }, [currentFile]);

  useEffect(() => {
    statusRef.current = status;
    playingRef.current = status.playing;
  }, [status]);

  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  useEffect(
    () => () => {
      releaseAudioPlayer(playerRef.current);
    },
    [],
  );

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch((caughtError: unknown) => {
      onError(caughtError instanceof Error ? caughtError.message : 'Audio could not start.');
    });
  }, [onError]);

  const saveCurrent = useCallback(
    async (position = statusRef.current.currentTime, duration = statusRef.current.duration) => {
      const file = currentFileRef.current;
      if (!file || duration <= 0) return;
      await onProgress({
        fileId: file.id,
        position: rememberTimestampRef.current ? position : 0,
        duration,
        completedAt: completedAtRef.current,
        updatedAt: Date.now(),
      });
    },
    [onProgress],
  );

  useEffect(() => {
    const second = Math.floor(status.currentTime);
    if (
      currentFile &&
      status.isLoaded &&
      !status.didJustFinish &&
      second > 0 &&
      second - lastSavedSecondRef.current >= 5
    ) {
      lastSavedSecondRef.current = second;
      void saveCurrent();
    }
  }, [currentFile, saveCurrent, status.currentTime, status.didJustFinish, status.isLoaded]);

  useEffect(() => {
    if (!currentFile || !finishGateRef.current) return;
    const result = advanceFinishGate(finishGateRef.current, {
      currentTime: status.currentTime,
      didJustFinish: status.didJustFinish,
      duration: status.duration,
      isLoaded: status.isLoaded,
    });
    finishGateRef.current = result.gate;
    if (!result.shouldFinish) return;
    playingRef.current = false;
    const completedAt = Date.now();
    completedAtRef.current = completedAt;
    void onProgress({
      fileId: currentFile.id,
      position: status.duration,
      duration: status.duration,
      completedAt,
      updatedAt: completedAt,
    });
    onFinishedRef.current(currentFile.id);
  }, [
    currentFile,
    onProgress,
    status.currentTime,
    status.didJustFinish,
    status.duration,
    status.isLoaded,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') void saveCurrent();
    });
    return () => subscription.remove();
  }, [saveCurrent]);

  const replay = useCallback(async () => {
    const file = currentFileRef.current;
    const duration = statusRef.current.duration;
    if (!file || duration <= 0) return;

    completedAtRef.current = null;
    finishGateRef.current = { fileId: file.id, armed: true, handled: false };
    lastSavedSecondRef.current = 0;
    await playerRef.current.seekTo(0);
    await onProgress({
      fileId: file.id,
      position: 0,
      duration,
      completedAt: null,
      updatedAt: Date.now(),
    });
    playerRef.current.play();
    playingRef.current = true;
  }, [onProgress]);

  const play = useCallback(
    async (file: ICloudAudioFile, options: PlayOptions = {}) => {
      if (!file.localUri || file.downloadState !== 'downloaded') {
        onError('Download this file from iCloud before playing it.');
        return;
      }

      if (currentFileRef.current?.id === file.id) {
        rememberTimestampRef.current = options.rememberTimestamp ?? true;
        const activeStatus = statusRef.current;
        if (
          completedAtRef.current != null ||
          (activeStatus.duration > 0 && activeStatus.currentTime >= activeStatus.duration - 0.25)
        ) {
          await replay();
          return;
        }
        playerRef.current.play();
        playingRef.current = true;
        return;
      }

      await saveCurrent();
      const storedProgress = progressById.get(file.id);
      const rememberTimestamp = options.rememberTimestamp ?? true;
      const isReplay = storedProgress?.completedAt != null;
      const resumeAt = resolveResumePosition(storedProgress, rememberTimestamp);

      currentFileRef.current = file;
      setCurrentFile(file);
      completedAtRef.current = null;
      rememberTimestampRef.current = rememberTimestamp;
      lastSavedSecondRef.current = Math.floor(resumeAt);
      finishGateRef.current = createFinishGate(file.id);
      const activePlayer = playerRef.current;
      activePlayer.replace({ uri: file.localUri, name: file.name });
      activePlayer.setActiveForLockScreen(
        true,
        { title: file.name, artist: 'Playr' },
        { showSeekBackward: true, showSeekForward: true },
      );

      if (resumeAt > 0) await activePlayer.seekTo(resumeAt);
      if (isReplay && storedProgress) {
        await onProgress({ ...storedProgress, position: 0, completedAt: null, updatedAt: Date.now() });
      }
      activePlayer.play();
      playingRef.current = true;
    },
    [onError, onProgress, progressById, replay, saveCurrent],
  );

  const toggle = useCallback(() => {
    if (!currentFileRef.current) return;
    if (playingRef.current) {
      playerRef.current.pause();
      playingRef.current = false;
      void saveCurrent();
    } else {
      const activeStatus = statusRef.current;
      if (
        completedAtRef.current != null ||
        (activeStatus.duration > 0 && activeStatus.currentTime >= activeStatus.duration - 0.25)
      ) {
        void replay();
        return;
      }
      playerRef.current.play();
      playingRef.current = true;
    }
  }, [replay, saveCurrent]);

  const seekTo = useCallback(
    async (seconds: number) => {
      const duration = statusRef.current.duration;
      const boundedSeconds = Math.max(0, Math.min(seconds, duration));
      await playerRef.current.seekTo(boundedSeconds);
      await saveCurrent(boundedSeconds, duration);
    },
    [saveCurrent],
  );

  const skip = useCallback(
    (seconds: number) => seekTo(statusRef.current.currentTime + seconds),
    [seekTo],
  );

  const stop = useCallback(async () => {
    await saveCurrent();
    playingRef.current = false;
    currentFileRef.current = null;
    finishGateRef.current = null;
    setCurrentFile(null);

    const previousPlayer = playerRef.current;
    const replacementPlayer = createPlaybackPlayer();
    playerRef.current = replacementPlayer;
    setPlayer(replacementPlayer);
    releaseAudioPlayer(previousPlayer);

    // Give File Provider one run-loop turn after AVPlayer deallocation.
    await wait(50);
  }, [saveCurrent]);

  return {
    currentFile,
    status,
    play,
    toggle,
    seekTo,
    skip,
    replay,
    stop,
  };
}
