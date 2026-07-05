/**
 * Pure policy for stop-marker visibility on the Build map.
 *
 * Extracted from Map.tsx so the ranking, visibility, and persisted-stop
 * merge rules are testable without MapLibre.
 */

export interface RankableStop {
  name: string;
  coordinates: [number, number];
}

/** How many route-nearest stops stay visible when "All pins" is off. */
export const DEFAULT_VISIBLE_LIMIT = 10;

/** Minimum distance in miles from a point to the nearest route vertex. */
export function minRouteDistanceMiles(
  coord: [number, number],
  routeCoords: number[][],
): number {
  let bestDist = Infinity;
  for (let i = 0; i < routeCoords.length; i++) {
    const dLon =
      (coord[0] - routeCoords[i][0]) *
      Math.cos((((coord[1] + routeCoords[i][1]) / 2) * Math.PI) / 180);
    const dLat = coord[1] - routeCoords[i][1];
    const d = Math.sqrt(dLon * dLon + dLat * dLat);
    if (d < bestDist) bestDist = d;
  }
  // Convert degrees to miles (1 degree latitude ≈ 69.0 miles)
  return bestDist * 69.0;
}

/**
 * Names of the `limit` stops nearest the route — the reduced set shown
 * when "All pins" is toggled off. Without route coords, falls back to
 * the first `limit` stops in suggestion order.
 */
export function rankDefaultVisibleStops<T extends RankableStop>(
  stops: T[],
  routeCoords: number[][] | null | undefined,
  limit: number = DEFAULT_VISIBLE_LIMIT,
): Set<string> {
  return new Set(
    stops
      .map((stop) => ({
        stop,
        dist: routeCoords ? minRouteDistanceMiles(stop.coordinates, routeCoords) : 0,
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, limit)
      .map((r) => r.stop.name),
  );
}

/**
 * Whether a stop marker should be on the map. Selected stops are always
 * visible; everything else requires its category to be active, plus
 * either default-visible rank or the "All pins" toggle.
 */
export function isStopMarkerVisible(opts: {
  isSelected: boolean;
  inCategory: boolean;
  isDefaultVisible: boolean;
  showAllStops: boolean;
}): boolean {
  if (opts.isSelected) return true;
  return opts.inCategory && (opts.isDefaultVisible || opts.showAllStops);
}

/**
 * Suggested stops plus any persisted selections missing from them (by
 * name), so preserved-selection markers stay on the map after a refetch.
 */
export function mergePersistedStops<T extends { name: string }>(
  stops: T[],
  persisted: T[],
): T[] {
  const names = new Set(stops.map((s) => s.name));
  const extra = persisted.filter((s) => !names.has(s.name));
  return [...stops, ...extra];
}
