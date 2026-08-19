export type EpisodePressIntent = 'open' | 'toggle';

export function getEpisodePressIntent(
  fileId: string,
  currentFileId: string | null,
): EpisodePressIntent {
  return fileId === currentFileId ? 'toggle' : 'open';
}
