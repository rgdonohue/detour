/**
 * Trailing-edge debounced scheduler.
 *
 * `schedule(fn)` arms (or re-arms) a single timer; only the most recently
 * scheduled callback runs, `delayMs` after the last `schedule` call.
 * `cancel()` drops any pending callback without running it.
 *
 * Used to collapse rapid stop-selection toggles into one detour route
 * recomputation (see docs/LAUNCH_READINESS.md, "Frontend stop-selection
 * debounce").
 */
export interface DebouncedScheduler {
  schedule(fn: () => void): void;
  cancel(): void;
}

export function createDebouncedScheduler(delayMs: number): DebouncedScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule(fn) {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, delayMs);
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
