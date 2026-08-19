import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';

import type { ICloudAudioFile } from '../modules/playr-icloud';
import type { PlaybackProgress } from './storage';

type PlaybackOptions = {
  progressById: Map<string, PlaybackProgress>;
  onProgress: (progress: PlaybackProgress) => Promise<void>;
  onFinished: (fileId: string) => void;
  onError: (message: string) => void;
};

export function usePlayback({
  progressById,
  onProgress,
  onFinished,
  onError,
}: PlaybackOptions) {
  const player = useAudioPlayer(null, {
    updateInterval: 1_000,
    keepAudioSessionActive: true,
  });
  const status = useAudioPlayerStatus(player);
  const [currentFile, setCurrentFile] = useState<ICloudAudioFile | null>(null);
  const currentFileRef = useRef(currentFile);
  const statusRef = useRef(status);
  const completedAtRef = useRef<number | null>(null);
  const lastSavedSecondRef = useRef(0);
  const handledFinishRef = useRef(false);
  const onFinishedRef = useRef(onFinished);

  useEffect(() => {
    currentFileRef.current = currentFile;
  }, [currentFile]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

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
        position,
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
    if (!currentFile || !status.didJustFinish || handledFinishRef.current) return;
    handledFinishRef.current = true;
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
  }, [currentFile, onProgress, status.didJustFinish, status.duration]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') void saveCurrent();
    });
    return () => subscription.remove();
  }, [saveCurrent]);

  const play = useCallback(
    async (file: ICloudAudioFile) => {
      if (!file.localUri || file.downloadState !== 'downloaded') {
        onError('Download this file from iCloud before playing it.');
        return;
      }

      if (currentFileRef.current?.id === file.id) {
        player.play();
        return;
      }

      await saveCurrent();
      const storedProgress = progressById.get(file.id);
      const isReplay = storedProgress?.completedAt != null;
      const resumeAt = isReplay ? 0 : storedProgress?.position ?? 0;

      currentFileRef.current = file;
      setCurrentFile(file);
      completedAtRef.current = null;
      lastSavedSecondRef.current = Math.floor(resumeAt);
      handledFinishRef.current = false;
      player.replace({ uri: file.localUri, name: file.name });
      player.setActiveForLockScreen(
        true,
        { title: file.name, artist: 'Playr' },
        { showSeekBackward: true, showSeekForward: true },
      );

      if (resumeAt > 0) await player.seekTo(resumeAt);
      if (isReplay && storedProgress) {
        await onProgress({ ...storedProgress, position: 0, completedAt: null, updatedAt: Date.now() });
      }
      player.play();
    },
    [onError, onProgress, player, progressById, saveCurrent],
  );

  const toggle = useCallback(() => {
    if (!currentFileRef.current) return;
    if (statusRef.current.playing) {
      player.pause();
      void saveCurrent();
    } else {
      player.play();
    }
  }, [player, saveCurrent]);

  const seekTo = useCallback(
    async (seconds: number) => {
      const duration = statusRef.current.duration;
      const boundedSeconds = Math.max(0, Math.min(seconds, duration));
      await player.seekTo(boundedSeconds);
      await saveCurrent(boundedSeconds, duration);
    },
    [player, saveCurrent],
  );

  const skip = useCallback(
    (seconds: number) => seekTo(statusRef.current.currentTime + seconds),
    [seekTo],
  );

  const stop = useCallback(async () => {
    await saveCurrent();
    player.pause();
    player.clearLockScreenControls();
    player.replace(null);
    currentFileRef.current = null;
    setCurrentFile(null);
  }, [player, saveCurrent]);

  return {
    currentFile,
    status,
    play,
    toggle,
    seekTo,
    skip,
    stop,
  };
}
