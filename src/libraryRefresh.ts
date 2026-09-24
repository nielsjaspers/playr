/** Shares equivalent scans and invalidates results when a mutation changes the library. */
export function createLibraryRefresh() {
  let revision = 0;
  let pending: { revision: number; result: Promise<void> } | null = null;
  return {
    invalidate() { revision += 1; },
    run(scan: (isCurrent: () => boolean) => Promise<void>) {
      if (pending?.revision === revision) return pending.result;
      const startedAt = revision;
      const result = scan(() => startedAt === revision).finally(() => {
        if (pending?.result === result) pending = null;
      });
      pending = { revision, result };
      return result;
    },
  };
}
