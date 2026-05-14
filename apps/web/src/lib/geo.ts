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
