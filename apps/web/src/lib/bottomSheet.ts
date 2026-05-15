export type SnapName = "peek" | "half" | "full";

export interface SnapHeightsPx {
  peek: number;
  half: number;
  full: number;
}

const VELOCITY_THRESHOLD_PX_MS = 0.5;

/**
 * Given the current sheet height in px, the release velocity in px/ms
 * (positive = sheet shrinking, negative = sheet growing), and the configured
 * snap heights in px, return the snap target.
 *
 * Tie-resolution (rarely hit in practice): when two snaps are equidistant, the
 * larger snap wins (i.e. expand rather than shrink on a tie).
 */
export function computeTargetSnap(
  heightPx: number,
  velocityPxMs: number,
  snapPx: SnapHeightsPx,
): SnapName {
  if (velocityPxMs > VELOCITY_THRESHOLD_PX_MS) return "peek";
  if (velocityPxMs < -VELOCITY_THRESHOLD_PX_MS) return "full";

  const dPeek = Math.abs(heightPx - snapPx.peek);
  const dHalf = Math.abs(heightPx - snapPx.half);
  const dFull = Math.abs(heightPx - snapPx.full);

  // Prefer larger snap on ties: check full first, then half, then peek
  let best: SnapName = "full";
  let bestD = dFull;
  if (dHalf < bestD) { best = "half"; bestD = dHalf; }
  if (dPeek < bestD) { best = "peek"; bestD = dPeek; }
  return best;
}

export function nextSnapCycle(current: SnapName): SnapName {
  if (current === "peek") return "half";
  if (current === "half") return "full";
  return "peek";
}
