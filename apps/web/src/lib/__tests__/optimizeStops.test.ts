import { describe, it, expect } from "vitest";
import { optimizeStopOrder } from "../optimizeStops";
import type { StopSuggestion } from "../api";

function stop(name: string, coordinates: [number, number]): StopSuggestion {
  return {
    poi_id: null,
    name,
    category: "history",
    coordinates,
    description: null,
    distance_miles: 0,
    source: "static",
    source_category_note: null,
  };
}

const WEST: [number, number] = [-105.94, 35.68];
const EAST: [number, number] = [-105.9, 35.68];
const nearWest = stop("near-west", [-105.935, 35.681]);
const nearEast = stop("near-east", [-105.905, 35.681]);

describe("optimizeStopOrder", () => {
  it("orders preserved stops along the origin→destination direction", () => {
    const order = optimizeStopOrder(WEST, EAST, [nearEast, nearWest]);
    expect(order.map((s) => s.name)).toEqual(["near-west", "near-east"]);
  });

  it("re-optimizes the same stops when origin and destination swap", () => {
    const order = optimizeStopOrder(EAST, WEST, [nearWest, nearEast]);
    expect(order.map((s) => s.name)).toEqual(["near-east", "near-west"]);
  });

  it("returns single-stop selections as-is", () => {
    expect(optimizeStopOrder(WEST, EAST, [nearEast])).toEqual([nearEast]);
  });
});
