export type GeolocateState =
  | "idle"
  | "requesting"
  | "ok"
  | "denied"
  | "unavailable"
  | "out-of-range";

export interface GeolocateConfig {
  centerCoords: [number, number];
  maxMiles: number;
}

export type GeolocateInput =
  | { kind: "success"; coords: [number, number] }
  | { kind: "error"; code: 1 | 2 | 3 }; // 1=PERMISSION_DENIED, 2=POSITION_UNAVAILABLE, 3=TIMEOUT

export interface GeolocateResult {
  state: GeolocateState;
  coords: [number, number] | null;
}

const OUT_OF_RANGE_BUFFER_MILES = 2;

export function computeGeolocateState(
  input: GeolocateInput,
  config: GeolocateConfig,
): GeolocateResult {
  if (input.kind === "error") {
    if (input.code === 1) return { state: "denied", coords: null };
    return { state: "unavailable", coords: null };
  }
  const dist = haversineMiles(input.coords, config.centerCoords);
  if (dist > config.maxMiles + OUT_OF_RANGE_BUFFER_MILES) {
    return { state: "out-of-range", coords: input.coords };
  }
  return { state: "ok", coords: input.coords };
}

const EARTH_RADIUS_MILES = 3958.7613;

/** Great-circle distance between two [lon, lat] points, in miles. */
export function haversineMiles(
  a: [number, number],
  b: [number, number],
): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const lat1r = toRad(lat1);
  const lat2r = toRad(lat2);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1r) * Math.cos(lat2r) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}
