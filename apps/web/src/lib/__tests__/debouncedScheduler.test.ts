import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncedScheduler } from "../debouncedScheduler";

describe("createDebouncedScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the callback once, delayMs after schedule", () => {
    const scheduler = createDebouncedScheduler(400);
    const fn = vi.fn();

    scheduler.schedule(fn);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(399);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("collapses rapid schedules into one invocation of the latest callback", () => {
    const scheduler = createDebouncedScheduler(400);
    const first = vi.fn();
    const second = vi.fn();
    const third = vi.fn();

    scheduler.schedule(first);
    vi.advanceTimersByTime(100);
    scheduler.schedule(second);
    vi.advanceTimersByTime(100);
    scheduler.schedule(third);

    vi.runAllTimers();

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(third).toHaveBeenCalledTimes(1);
  });

  it("restarts the delay on each schedule so the callback fires delayMs after the last one", () => {
    const scheduler = createDebouncedScheduler(400);
    const fn = vi.fn();

    scheduler.schedule(fn);
    vi.advanceTimersByTime(300);
    scheduler.schedule(fn);
    vi.advanceTimersByTime(399);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel drops the pending callback", () => {
    const scheduler = createDebouncedScheduler(400);
    const fn = vi.fn();

    scheduler.schedule(fn);
    scheduler.cancel();
    vi.runAllTimers();

    expect(fn).not.toHaveBeenCalled();
  });

  it("cancel is safe with nothing pending and does not block later schedules", () => {
    const scheduler = createDebouncedScheduler(400);
    const fn = vi.fn();

    scheduler.cancel();
    scheduler.schedule(fn);
    vi.runAllTimers();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("scheduling again after a fire runs the new callback independently", () => {
    const scheduler = createDebouncedScheduler(400);
    const first = vi.fn();
    const second = vi.fn();

    scheduler.schedule(first);
    vi.runAllTimers();
    scheduler.schedule(second);
    vi.runAllTimers();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
