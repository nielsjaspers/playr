import type { PlaybackProgress } from './storage';

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  const remainder = wholeSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
    : `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

export function episodeProgressLabel(progress: PlaybackProgress | undefined, rememberTimestamps: boolean) {
  if (!rememberTimestamps || !progress) return null;
  const duration = Number.isFinite(progress.duration) ? Math.max(0, progress.duration) : 0;
  const position = Number.isFinite(progress.position) ? Math.max(0, progress.position) : 0;
  if (duration === 0) return position > 0 ? `Continue at ${formatDuration(position)}` : null;
  const elapsed = progress.completedAt != null ? duration : Math.min(position, duration);
  return `${formatDuration(elapsed)} · ${formatDuration(duration - elapsed)} left`;
}
