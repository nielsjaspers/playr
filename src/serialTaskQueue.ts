export function createSerialTaskQueue() {
  let tail: Promise<void> = Promise.resolve();

  return {
    run<T>(task: () => Promise<T>) {
      const result = tail.then(task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
