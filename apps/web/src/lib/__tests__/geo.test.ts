import { describe, it, expect } from "vitest";
import { haversineMiles } from "../geo";

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
