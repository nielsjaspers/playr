import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  createAudioPlayer,
  setAudioModeAsync,
  useAudioPlayerStatus,
} from 'expo-audio';

import type { ICloudAudioFile } from '../modules/playr-icloud';
import { createSerialTaskQueue } from './serialTaskQueue';
import { createProgressCheckpoint } from './progressCheckpoint';
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
  isCurrent?: () => boolean;
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
  const checkpoint = useRef(createProgressCheckpoint());
  const commands = useRef(createSerialTaskQueue());
  const sourceVersion = useRef(0);
  const switching = useRef(false);
  const [progressSaveError, setProgressSaveError] = useState<string | null>(null);
  const lastStartedFileIdRef = useRef<string | null>(null);
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
      sourceVersion.current += 1;
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

  const persistProgress = useCallback(
    async (progress: PlaybackProgress) => {
      try {
        await onProgress(progress);
        setProgressSaveError(null);
      } catch (error) {
        console.warn('Progress could not be saved', error);
        setProgressSaveError('Listening progress could not be saved. Playr will retry.');
      }
    },
    [onProgress],
  );

  useEffect(() => {
    if (
      switching.current ||
      !currentFile ||
      !status.isLoaded ||
      status.duration <= 0 ||
      finishGateRef.current?.fileId !== currentFile.id ||
      !finishGateRef.current.armed ||
      lastStartedFileIdRef.current === currentFile.id
    ) {
      return;
    }
    lastStartedFileIdRef.current = currentFile.id;
    void persistProgress({
      fileId: currentFile.id,
      position: rememberTimestampRef.current ? status.currentTime : 0,
      duration: status.duration,
      completedAt: null,
      updatedAt: Date.now(),
    });
  }, [currentFile, persistProgress, status.currentTime, status.duration, status.isLoaded]);

  const saveCurrent = useCallback(
    async (position = statusRef.current.currentTime, duration = statusRef.current.duration) => {
      const file = currentFileRef.current;
      if (!file || duration <= 0) return;
      await persistProgress({
        fileId: file.id,
        position: rememberTimestampRef.current ? position : 0,
        duration,
        completedAt: completedAtRef.current,
        updatedAt: Date.now(),
      });
    },
    [persistProgress],
  );

  const completePlayback = useCallback(
    (file: ICloudAudioFile, duration: number) => {
      playingRef.current = false;
      const completedAt = Date.now();
      completedAtRef.current = completedAt;
      void persistProgress({
        fileId: file.id,
        position: duration,
        duration,
        completedAt,
        updatedAt: completedAt,
      });
      onFinishedRef.current(file.id);
    },
    [persistProgress],
  );

  useEffect(() => {
    if (!switching.current && currentFile && status.isLoaded && status.playing &&
        !status.didJustFinish && checkpoint.current.isDue()) {
      checkpoint.current.saved();
      void saveCurrent();
    }
  }, [currentFile, saveCurrent, status.currentTime, status.didJustFinish, status.isLoaded, status.playing]);

  useEffect(() => {
    if (switching.current || !currentFile || !finishGateRef.current) return;
    const result = advanceFinishGate(finishGateRef.current, {
      currentTime: status.currentTime,
      didJustFinish: status.didJustFinish,
      duration: status.duration,
      isLoaded: status.isLoaded,
    });
    finishGateRef.current = result.gate;
    if (!result.shouldFinish) return;
    completePlayback(currentFile, status.duration);
  }, [
    completePlayback,
    currentFile,
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

  // All native mutations share this queue. Downloads never enter it.
  const runCommand = useCallback(async <T,>(task: () => Promise<T>) => {
    try {
      return await commands.current.run(task);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'The player could not complete that action.');
      return undefined;
    }
  }, [onError]);

  const replayCurrent = useCallback(async (isCurrent: () => boolean) => {
    const file = currentFileRef.current;
    const duration = statusRef.current.duration;
    if (!file || duration <= 0 || !isCurrent()) return false;
    completedAtRef.current = null;
    finishGateRef.current = { fileId: file.id, armed: true, handled: false };
    checkpoint.current.saved();
    await playerRef.current.seekTo(0);
    if (!isCurrent()) return false;
    void persistProgress({ fileId: file.id, position: 0, duration, completedAt: null, updatedAt: Date.now() });
    playerRef.current.play();
    playingRef.current = true;
    return true;
  }, [persistProgress]);

  const play = useCallback(async (file: ICloudAudioFile, options: PlayOptions = {}) => {
    const version = ++sourceVersion.current;
    const isCurrent = () => sourceVersion.current === version && (options.isCurrent?.() ?? true);
    return Boolean(await runCommand(async () => {
      if (!isCurrent()) return false;
      if (!file.localUri || file.downloadState !== 'downloaded') {
        throw new Error('Download this file from iCloud before playing it.');
      }
      if (currentFileRef.current?.id === file.id) {
        rememberTimestampRef.current = options.rememberTimestamp ?? true;
        const activeStatus = statusRef.current;
        if (completedAtRef.current != null ||
            (activeStatus.duration > 0 && activeStatus.currentTime >= activeStatus.duration - 0.25)) {
          return replayCurrent(isCurrent);
        }
        playerRef.current.play();
        playingRef.current = true;
        return true;
      }
      await saveCurrent();
      if (!isCurrent()) return false;
      switching.current = true;
      try {
        const storedProgress = progressById.get(file.id);
        const rememberTimestamp = options.rememberTimestamp ?? true;
        const resumeAt = resolveResumePosition(storedProgress, rememberTimestamp);
        const activePlayer = playerRef.current;
        activePlayer.replace({ uri: file.localUri, name: file.name });
        activePlayer.setActiveForLockScreen(true, { title: file.name, artist: 'Playr' },
          { showSeekBackward: true, showSeekForward: true });
        if (resumeAt > 0) await activePlayer.seekTo(resumeAt);
        if (!isCurrent()) {
          activePlayer.pause();
          activePlayer.replace(null);
          activePlayer.clearLockScreenControls();
          currentFileRef.current = null;
          finishGateRef.current = null;
          playingRef.current = false;
          setCurrentFile(null);
          return false;
        }
        currentFileRef.current = file;
        setCurrentFile(file);
        lastStartedFileIdRef.current = null;
        completedAtRef.current = null;
        rememberTimestampRef.current = rememberTimestamp;
        checkpoint.current.saved();
        finishGateRef.current = createFinishGate(file.id);
        if (storedProgress?.completedAt != null) {
          void persistProgress({ ...storedProgress, position: 0, completedAt: null, updatedAt: Date.now() });
        }
        activePlayer.play();
        playingRef.current = true;
        return true;
      } finally {
        switching.current = false;
      }
    }));
  }, [persistProgress, progressById, replayCurrent, runCommand, saveCurrent]);

  const replay = useCallback(async () => {
    const version = ++sourceVersion.current;
    await runCommand(() => replayCurrent(() => sourceVersion.current === version));
  }, [replayCurrent, runCommand]);

  const toggle = useCallback(async () => {
    const version = ++sourceVersion.current;
    await runCommand(async () => {
      if (!currentFileRef.current || version !== sourceVersion.current) return;
      if (playingRef.current) {
        playerRef.current.pause();
        playingRef.current = false;
        await saveCurrent();
      } else {
        const activeStatus = statusRef.current;
        if (completedAtRef.current != null ||
            (activeStatus.duration > 0 && activeStatus.currentTime >= activeStatus.duration - 0.25)) {
          await replayCurrent(() => sourceVersion.current === version);
        } else {
          playerRef.current.play();
          playingRef.current = true;
        }
      }
    });
  }, [replayCurrent, runCommand, saveCurrent]);

  const seekTo = useCallback(async (seconds: number) => {
    const version = sourceVersion.current;
    await runCommand(async () => {
      if (version !== sourceVersion.current || !currentFileRef.current) return;
      const duration = statusRef.current.duration;
      const bounded = Math.max(0, Math.min(seconds, duration));
      await playerRef.current.seekTo(bounded);
      if (version !== sourceVersion.current) return;
      checkpoint.current.saved();
      await saveCurrent(bounded, duration);
    });
  }, [runCommand, saveCurrent]);

  const skip = useCallback(async (seconds: number) => {
    const version = sourceVersion.current;
    await runCommand(async () => {
      if (version !== sourceVersion.current) return;
      const activeStatus = statusRef.current;
      const file = currentFileRef.current;
      if (!file) return;
      const target = Math.max(0, Math.min(activeStatus.duration, activeStatus.currentTime + seconds));
      await playerRef.current.seekTo(target);
      if (version !== sourceVersion.current) return;
      checkpoint.current.saved();
      if (seconds > 0 && activeStatus.duration > 0 && target >= activeStatus.duration) {
        const gate = finishGateRef.current;
        if (gate && !gate.handled) {
          finishGateRef.current = { ...gate, armed: true, handled: true };
          completePlayback(file, activeStatus.duration);
        }
      } else {
        await saveCurrent(target, activeStatus.duration);
      }
    });
  }, [completePlayback, runCommand, saveCurrent]);

  const stop = useCallback(async () => {
    ++sourceVersion.current;
    return Boolean(await runCommand(async () => {
      await saveCurrent();
      const previousPlayer = playerRef.current;
      previousPlayer.pause();
      const replacementPlayer = createPlaybackPlayer();
      playerRef.current = replacementPlayer;
      setPlayer(replacementPlayer);
      playingRef.current = false;
      currentFileRef.current = null;
      lastStartedFileIdRef.current = null;
      finishGateRef.current = null;
      setCurrentFile(null);
      releaseAudioPlayer(previousPlayer);
      // Give File Provider one run-loop turn after AVPlayer deallocation.
      await wait(50);
      return true;
    }));
  }, [runCommand, saveCurrent]);

  return {
    currentFile,
    status,
    progressSaveError,
    play,
    toggle,
    seekTo,
    skip,
    replay,
    stop,
  };
}
