import { describe, it, expect } from "vitest";
import {
  rankDefaultVisibleStops,
  isStopMarkerVisible,
  mergePersistedStops,
} from "../stopMarkerPolicy";

function stop(name: string, coordinates: [number, number]) {
  return { name, coordinates };
}

// A short west-to-east route segment through Santa Fe
const ROUTE: number[][] = [
  [-105.94, 35.68],
  [-105.93, 35.68],
  [-105.92, 35.68],
];

describe("rankDefaultVisibleStops", () => {
  it("keeps the stops nearest the route when over the limit", () => {
    const near = stop("near", [-105.93, 35.681]); // ~0.07 mi off route
    const mid = stop("mid", [-105.93, 35.69]); // ~0.7 mi off route
    const far = stop("far", [-105.93, 35.75]); // ~5 mi off route
    const names = rankDefaultVisibleStops([far, near, mid], ROUTE, 2);
    expect(names).toEqual(new Set(["near", "mid"]));
  });

  it("includes all stops when at or under the limit", () => {
    const a = stop("a", [-105.93, 35.681]);
    const b = stop("b", [-105.93, 35.75]);
    expect(rankDefaultVisibleStops([a, b], ROUTE, 10)).toEqual(
      new Set(["a", "b"]),
    );
  });

  it("falls back to the first N stops when no route coords are available", () => {
    const stops = [stop("a", [-105.9, 35.7]), stop("b", [-105.9, 35.7]), stop("c", [-105.9, 35.7])];
    expect(rankDefaultVisibleStops(stops, undefined, 2)).toEqual(
      new Set(["a", "b"]),
    );
  });
});

describe("isStopMarkerVisible", () => {
  it("always shows selected stops, even with category off and all-pins off", () => {
    expect(
      isStopMarkerVisible({
        isSelected: true,
        inCategory: false,
        isDefaultVisible: false,
        showAllStops: false,
      }),
    ).toBe(true);
  });

  it("hides unselected stops whose category is off, even with all-pins on", () => {
    expect(
      isStopMarkerVisible({
        isSelected: false,
        inCategory: false,
        isDefaultVisible: true,
        showAllStops: true,
      }),
    ).toBe(false);
  });

  it("shows every in-category stop when all-pins is on", () => {
    expect(
      isStopMarkerVisible({
        isSelected: false,
        inCategory: true,
        isDefaultVisible: false,
        showAllStops: true,
      }),
    ).toBe(true);
  });

  it("shows only default-visible stops when all-pins is off", () => {
    expect(
      isStopMarkerVisible({
        isSelected: false,
        inCategory: true,
        isDefaultVisible: true,
        showAllStops: false,
      }),
    ).toBe(true);
    expect(
      isStopMarkerVisible({
        isSelected: false,
        inCategory: true,
        isDefaultVisible: false,
        showAllStops: false,
      }),
    ).toBe(false);
  });
});

describe("mergePersistedStops", () => {
  it("appends persisted stops missing from the suggestions", () => {
    const suggested = [stop("a", [-105.9, 35.7]), stop("b", [-105.9, 35.7])];
    const persisted = [stop("b", [-105.9, 35.7]), stop("c", [-105.9, 35.7])];
    expect(mergePersistedStops(suggested, persisted).map((s) => s.name)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns suggestions unchanged when nothing is persisted", () => {
    const suggested = [stop("a", [-105.9, 35.7])];
    expect(mergePersistedStops(suggested, []).map((s) => s.name)).toEqual(["a"]);
  });

  it("keeps duplicate-named persisted stops out even when suggestions are empty of them", () => {
    const persisted = [stop("c", [-105.9, 35.7])];
    expect(mergePersistedStops([], persisted).map((s) => s.name)).toEqual(["c"]);
  });
});
