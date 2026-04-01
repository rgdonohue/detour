/**
 * Typed API client for 3-Mile Drive Map backend.
 * Base URL from env or defaults to /api (proxied by Vite).
 */

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export interface Config {
  origin_name: string;
  address: string;
  coordinates: [number, number];
  default_miles: number;
  max_miles: number;
}

type PolygonCoords = number[][][];
type MultiPolygonCoords = number[][][][];
type LineStringCoords = number[][];

export interface AreaFeature {
  type: "Feature";
  geometry:
    | { type: "Polygon"; coordinates: PolygonCoords }
    | { type: "MultiPolygon"; coordinates: MultiPolygonCoords };
  properties: {
    distance_miles?: number;
    distance_meters?: number;
    computed_at?: string;
  };
}

export interface AreaResponse {
  type: "FeatureCollection";
  features: AreaFeature[];
}

export interface RouteResponse {
  route: {
    type: "Feature";
    geometry: { type: "LineString"; coordinates: LineStringCoords };
    properties: Record<string, unknown>;
  };
  distance_meters: number;
  distance_miles: number;
  duration_seconds: number;
  within_limit: boolean;
  limit_miles: number;
}

export interface StopSuggestion {
  name: string;
  category: string;
  coordinates: [number, number];
  description: string | null;
  distance_miles: number;
  source: "ors" | "static";
  source_category_note: "approximate" | null;
}

export interface SuggestStopResponse {
  stop: StopSuggestion | null;
  fallback: boolean;
}

const FETCH_TIMEOUT_MS = 5000;
const ROUTE_TIMEOUT_MS = 15000; // ORS can be slow; fail after 15s

async function fetchWithTimeout(
  url: string,
  timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    if (e instanceof Error) {
      if (e.name === "AbortError") {
        throw new Error("Route check timed out. The service may be busy.");
      }
      if (e.message === "Failed to fetch" || e.message.includes("NetworkError")) {
        throw new Error("Unable to connect. Check your internet connection.");
      }
    }
    throw e;
  }
}

export async function getConfig(): Promise<Config> {
  const res = await fetchWithTimeout(`${API_BASE}/config`);
  if (!res.ok) throw new Error(`Config failed: ${res.status}`);
  return res.json();
}

export async function getArea(
  miles: number = 3,
  originLon?: number,
  originLat?: number,
): Promise<AreaResponse> {
  const params = new URLSearchParams({ miles: String(miles) });
  if (originLon !== undefined && originLat !== undefined) {
    params.set("origin", `${originLon},${originLat}`);
  }
  const res = await fetch(`${API_BASE}/area?${params}`);
  if (!res.ok) throw new Error(`Area failed: ${res.status}`);
  return res.json();
}

export async function suggestStop(
  originLon: number,
  originLat: number,
  destLon: number,
  destLat: number,
  category: string | null,
  miles?: number,
): Promise<SuggestStopResponse> {
  const params = new URLSearchParams({
    origin: `${originLon},${originLat}`,
    destination: `${destLon},${destLat}`,
  });
  if (category !== null) params.set("category", category);
  if (miles !== undefined) params.set("miles", String(miles));
  const res = await fetchWithTimeout(
    `${API_BASE}/suggest-stop?${params}`,
    ROUTE_TIMEOUT_MS,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Suggest-stop failed: ${res.status}`);
  }
  return res.json();
}

export async function getRoute(
  destLon: number,
  destLat: number,
  miles?: number,
  originLon?: number,
  originLat?: number,
  viaLon?: number,
  viaLat?: number,
): Promise<RouteResponse> {
  const params = new URLSearchParams({ to: `${destLon},${destLat}` });
  if (miles !== undefined) params.set("miles", String(miles));
  if (originLon !== undefined && originLat !== undefined) {
    params.set("origin", `${originLon},${originLat}`);
  }
  if (viaLon !== undefined && viaLat !== undefined) {
    params.set("via", `${viaLon},${viaLat}`);
  }
  const res = await fetchWithTimeout(
    `${API_BASE}/route?${params}`,
    ROUTE_TIMEOUT_MS
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Route failed: ${res.status}`);
  }
  return res.json();
}
