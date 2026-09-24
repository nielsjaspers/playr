/** A request stays current through downloads, prompts, and queued player commands. */
export function createPlaybackRequests() {
  let controller: AbortController | null = null;
  return {
    begin() {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      return { signal, isCurrent: () => !signal.aborted };
    },
    cancel() {
      controller?.abort();
      controller = null;
    },
  };
}

export type PlaybackRequest = ReturnType<ReturnType<typeof createPlaybackRequests>['begin']>;
