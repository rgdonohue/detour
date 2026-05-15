import { describe, it, expect } from "vitest";
import { computeTargetSnap, nextSnapCycle, type SnapName } from "../bottomSheet";

const snapPx = { peek: 80, half: 360, full: 720 } as const;

describe("computeTargetSnap", () => {
  it("snaps to exact snap heights when velocity is low", () => {
    expect(computeTargetSnap(80, 0, snapPx)).toBe<SnapName>("peek");
    expect(computeTargetSnap(360, 0, snapPx)).toBe<SnapName>("half");
    expect(computeTargetSnap(720, 0, snapPx)).toBe<SnapName>("full");
  });

  it("snaps to nearest when velocity is low and height is between snaps", () => {
    expect(computeTargetSnap(150, 0, snapPx)).toBe<SnapName>("peek"); // d=70 vs d=210
    expect(computeTargetSnap(260, 0, snapPx)).toBe<SnapName>("half"); // d=100 vs d=180
    expect(computeTargetSnap(600, 0, snapPx)).toBe<SnapName>("full"); // d=120 vs d=240
  });

  it("snaps down (peek) when release velocity is downward and above threshold", () => {
    expect(computeTargetSnap(400, 1.0, snapPx)).toBe<SnapName>("peek");
    expect(computeTargetSnap(400, 0.6, snapPx)).toBe<SnapName>("peek");
  });

  it("snaps up (full) when release velocity is upward and above threshold", () => {
    expect(computeTargetSnap(400, -1.0, snapPx)).toBe<SnapName>("full");
    expect(computeTargetSnap(400, -0.6, snapPx)).toBe<SnapName>("full");
  });

  it("uses distance when velocity is below threshold", () => {
    expect(computeTargetSnap(150, 0.3, snapPx)).toBe<SnapName>("peek");
    expect(computeTargetSnap(600, -0.3, snapPx)).toBe<SnapName>("full");
  });
});

describe("nextSnapCycle", () => {
  it("cycles peek -> half -> full -> peek", () => {
    expect(nextSnapCycle("peek")).toBe<SnapName>("half");
    expect(nextSnapCycle("half")).toBe<SnapName>("full");
    expect(nextSnapCycle("full")).toBe<SnapName>("peek");
  });
});
