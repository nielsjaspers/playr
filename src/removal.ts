import type { ICloudFileOperationResult } from '../modules/playr-icloud';

type RemoveDownloads = (ids: string[]) => Promise<ICloudFileOperationResult[]>;
type Wait = (milliseconds: number) => Promise<void>;
type RetryUpdate = {
  attempt: number;
  maximumAttempts: number;
  delayMilliseconds: number;
};
type RetryOptions = {
  waitForRetry?: Wait;
  onRetry?: (update: RetryUpdate) => void;
};

const LOCK_RETRY_DELAYS_MS = [250, 750, 1_500];

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function isFileLockFailure(result: ICloudFileOperationResult) {
  return !result.succeeded && result.retryable;
}

export async function removeDownloadsWithLockRetry(
  ids: string[],
  removeDownloads: RemoveDownloads,
  options: RetryOptions = {},
) {
  const waitForRetry = options.waitForRetry ?? wait;
  let results = await removeDownloads(ids);

  for (const [index, delay] of LOCK_RETRY_DELAYS_MS.entries()) {
    const lockedIds = results.filter(isFileLockFailure).map((result) => result.id);
    if (lockedIds.length === 0) break;

    options.onRetry?.({
      attempt: index + 1,
      maximumAttempts: LOCK_RETRY_DELAYS_MS.length,
      delayMilliseconds: delay,
    });
    await waitForRetry(delay);
    const retryResults = await removeDownloads(lockedIds);
    const retryById = new Map(retryResults.map((result) => [result.id, result]));
    results = results.map((result) => retryById.get(result.id) ?? result);
  }

  return results;
}

export function formatRemovalFailure(result: ICloudFileOperationResult) {
  if (result.retryable) {
    return 'Close the file in Files, then try again. The audio file is still downloaded.';
  }
  return result.error ?? 'A local download could not be removed.';
}
