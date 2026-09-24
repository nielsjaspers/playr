/** Uses elapsed time so seeking in either direction cannot postpone checkpoints. */
export function createProgressCheckpoint(now = () => performance.now()) {
  let lastSavedAt = now();
  return {
    isDue: () => now() - lastSavedAt >= 5_000,
    saved: () => { lastSavedAt = now(); },
  };
}
