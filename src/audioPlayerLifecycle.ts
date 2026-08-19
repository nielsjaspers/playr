import type { AudioPlayer } from 'expo-audio';

type ReleasableAudioPlayer = Pick<
  AudioPlayer,
  'pause' | 'clearLockScreenControls' | 'replace' | 'release'
>;

/** Detaches the AVPlayerItem, then releases AVPlayer so iCloud can evict its file. */
export function releaseAudioPlayer(player: ReleasableAudioPlayer) {
  player.pause();
  player.clearLockScreenControls();
  player.replace(null);
  player.release();
}
