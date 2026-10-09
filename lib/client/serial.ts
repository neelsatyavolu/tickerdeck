/**
 * Runs async jobs one at a time in submission order, so rapid edits (several
 * reorder clicks) reach the server in the order they were made. A failed job
 * doesn't block the ones after it.
 */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(job: () => Promise<T>): Promise<T> {
    const result = tail.then(job, job);
    tail = result.catch(() => undefined);
    return result;
  };
}
