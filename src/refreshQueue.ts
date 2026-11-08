/** Coalesce refresh bursts without caching data across mutations or applying an older response last. */
export function createRefreshQueue<T>(load: () => Promise<T>, apply: (value: T) => void, onError: (reason: unknown) => void) {
  let disposed = false, running = false, again = false;
  async function request(): Promise<void> {
    if (disposed) return;
    if (running) { again = true; return; }
    running = true;
    try {
      do {
        again = false;
        try { const value = await load(); if (!disposed && !again) apply(value); }
        catch (reason) { if (!disposed && !again) onError(reason); }
      } while (again && !disposed);
    } finally { running = false; }
  }
  return { request, dispose() { disposed = true; again = false; } };
}
