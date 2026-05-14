import { describe, it, expect } from "vitest";
import { haversineMiles } from "../geo";
import { computeGeolocateState } from "../geo";

describe("haversineMiles", () => {
  it("returns 0 for identical coords", () => {
    const p: [number, number] = [-105.9384, 35.6824];
    expect(haversineMiles(p, p)).toBe(0);
  });

  it("returns ~1 mile for two nearby Santa Fe points", () => {
    const a: [number, number] = [-105.9384, 35.6824];
    const b: [number, number] = [-105.9384, 35.6969]; // ~1 mile north
    expect(haversineMiles(a, b)).toBeGreaterThan(0.9);
    expect(haversineMiles(a, b)).toBeLessThan(1.1);
  });

  it("returns >1000 miles between Santa Fe and NYC", () => {
    const sf: [number, number] = [-105.9384, 35.6824];
    const nyc: [number, number] = [-74.0060, 40.7128];
    expect(haversineMiles(sf, nyc)).toBeGreaterThan(1500);
    expect(haversineMiles(sf, nyc)).toBeLessThan(2000);
  });
});

describe("computeGeolocateState", () => {
  const config = { centerCoords: [-105.9384, 35.6824] as [number, number], maxMiles: 5 };

  it("returns ok when within range", () => {
    const result = computeGeolocateState({ kind: "success", coords: [-105.9384, 35.6969] }, config);
    expect(result.state).toBe("ok");
    expect(result.coords).toEqual([-105.9384, 35.6969]);
  });

  it("returns out-of-range when beyond maxMiles + 2", () => {
    const result = computeGeolocateState({ kind: "success", coords: [-74.0060, 40.7128] }, config);
    expect(result.state).toBe("out-of-range");
    expect(result.coords).toEqual([-74.0060, 40.7128]);
  });

  it("returns ok when within the +2 buffer", () => {
    // 6 miles north of center, with maxMiles=5 buffer is 7. 6 < 7 => ok.
    const result = computeGeolocateState(
      { kind: "success", coords: [-105.9384, 35.6824 + 6 / 69.0] },
      config,
    );
    expect(result.state).toBe("ok");
  });

  it("returns denied for permission error", () => {
    const result = computeGeolocateState({ kind: "error", code: 1 }, config);
    expect(result.state).toBe("denied");
    expect(result.coords).toBeNull();
  });

  it("returns unavailable for position-unavailable error", () => {
    const result = computeGeolocateState({ kind: "error", code: 2 }, config);
    expect(result.state).toBe("unavailable");
  });

  it("returns unavailable for timeout error", () => {
    const result = computeGeolocateState({ kind: "error", code: 3 }, config);
    expect(result.state).toBe("unavailable");
  });
});
