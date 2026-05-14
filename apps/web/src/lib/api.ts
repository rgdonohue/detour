/**
 * Typed API client for Detour backend.
 * Base URL from env or defaults to /api (proxied by Vite).
 */

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export type TravelMode = "drive" | "walk";

/**
 * Thrown by API helpers. Carries the HTTP status and an optional
 * `retryAfterSeconds` so callers can render a backoff-aware message
 * when the backend returns 429.
 */
export class ApiError extends Error {
  status: number;
  retryAfterSeconds?: number;
  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function _throwFromResponse(res: Response, fallback: string): Promise<never> {
  const body = await res.json().catch(() => ({} as Record<string, unknown>));
  const detail = body.detail;
  // Backend may return `detail` as a string (most errors) or, in older paths,
  // as a structured object. Coerce to a clean human string either way.
  const message = typeof detail === "string"
    ? detail
    : (detail && typeof detail === "object")
      ? fallback
      : fallback;
  const retryAfterRaw = (body as { retry_after_seconds?: unknown }).retry_after_seconds;
  const retryAfterSeconds = typeof retryAfterRaw === "number" ? retryAfterRaw : undefined;
  throw new ApiError(message, res.status, retryAfterSeconds);
}

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
  poi_id: string | null;
  name: string;
  category: string;
  coordinates: [number, number];
  description: string | null;
  distance_miles: number;
  route_position?: number;
  source: "ors" | "static";
  source_category_note: "approximate" | null;
  // Rich description fields (present for static-source stops)
  description_map?: string | null;
  description_card?: string | null;
  subcategory?: string | null;
  confidence?: string | null;
  basis?: string | null;
  wikipedia_title?: string | null;
  address?: string | null;
}

export interface SuggestStopResponse {
  stops: StopSuggestion[];
  fallback: boolean;
}

export interface PoiFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    name: string;
    category: string;
    wikipedia_title: string | null;
    quality_score: number;
    description_map: string | null;
    description_card: string | null;
    subcategory: string | null;
    confidence: string | null;
    basis: string | null;
    address: string | null;
  };
}

export interface PoisResponse {
  type: "FeatureCollection";
  features: PoiFeature[];
}

export async function getPois(signal?: AbortSignal): Promise<PoisResponse> {
  const res = await fetchWithTimeout(`${API_BASE}/pois`, FETCH_TIMEOUT_MS, signal);
  if (!res.ok) throw new Error(`POIs failed: ${res.status}`);
  return res.json();
}

const FETCH_TIMEOUT_MS = 5000;
const ROUTE_TIMEOUT_MS = 15000; // ORS can be slow; fail after 15s

async function fetchWithTimeout(
  url: string,
  timeoutMs: number = FETCH_TIMEOUT_MS,
  externalSignal?: AbortSignal,
  init?: Omit<RequestInit, "signal">,
): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);

  let onAbort: (() => void) | null = null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(id);
      throw new DOMException("Aborted", "AbortError");
    }
    onAbort = () => ctrl.abort();
    externalSignal.addEventListener("abort", onAbort, { once: true });
  }

  const cleanup = () => {
    clearTimeout(id);
    if (onAbort && externalSignal) {
      externalSignal.removeEventListener("abort", onAbort);
    }
  };

  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    cleanup();
    return res;
  } catch (e) {
    cleanup();
    if (e instanceof Error && e.name === "AbortError") {
      if (externalSignal?.aborted) throw e; // user-initiated abort — propagate as-is
      throw new Error("Route check timed out. The service may be busy.");
    }
    if (
      e instanceof Error &&
      (e.message === "Failed to fetch" || e.message.includes("NetworkError"))
    ) {
      throw new Error("Unable to connect. Check your internet connection.");
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
  originLon?: number,
  originLat?: number,
  mode?: TravelMode,
  signal?: AbortSignal,
): Promise<AreaResponse> {
  const params = new URLSearchParams();
  if (originLon !== undefined && originLat !== undefined) {
    params.set("origin", `${originLon},${originLat}`);
  }
  if (mode && mode !== "drive") params.set("mode", mode);
  const res = await fetch(`${API_BASE}/area?${params}`, { signal });
  if (!res.ok) await _throwFromResponse(res, `Area failed: ${res.status}`);
  return res.json();
}

export async function suggestStop(
  originLon: number,
  originLat: number,
  destLon: number,
  destLat: number,
  category: string | null,
  miles?: number,
  mode?: TravelMode,
  signal?: AbortSignal,
  routeCoordinates?: number[][],
): Promise<SuggestStopResponse> {
  let res: Response;
  if (routeCoordinates && routeCoordinates.length >= 2) {
    const body: Record<string, unknown> = {
      origin: `${originLon},${originLat}`,
      destination: `${destLon},${destLat}`,
      route_coordinates: routeCoordinates,
    };
    if (category !== null) body.category = category;
    if (miles !== undefined) body.miles = miles;
    if (mode) body.mode = mode;
    res = await fetchWithTimeout(`${API_BASE}/suggest-stop`, ROUTE_TIMEOUT_MS, signal, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } else {
    const params = new URLSearchParams({
      origin: `${originLon},${originLat}`,
      destination: `${destLon},${destLat}`,
    });
    if (category !== null) params.set("category", category);
    if (miles !== undefined) params.set("miles", String(miles));
    if (mode && mode !== "drive") params.set("mode", mode);
    res = await fetchWithTimeout(`${API_BASE}/suggest-stop?${params}`, ROUTE_TIMEOUT_MS, signal);
  }
  if (!res.ok) await _throwFromResponse(res, `Suggest-stop failed: ${res.status}`);
  const data = await res.json();
  data.stops ??= [];
  return data as SuggestStopResponse;
}

export interface SaveTourResponse {
  slug: string;
  url: string;
}

/**
 * Persist a user-built tour. Returns the assigned slug — backend is
 * authoritative for slug assignment, so any client-side `slug` field
 * on the payload is ignored.
 */
export async function saveTour(
  tour: unknown,
  signal?: AbortSignal,
): Promise<SaveTourResponse> {
  const res = await fetchWithTimeout(`${API_BASE}/tours`, ROUTE_TIMEOUT_MS, signal, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tour),
  });
  if (!res.ok) await _throwFromResponse(res, `Save tour failed: ${res.status}`);
  return res.json();
}

export async function getRoute(
  destLon: number,
  destLat: number,
  miles?: number,
  originLon?: number,
  originLat?: number,
  viaCoords?: [number, number][],
  mode?: TravelMode,
  signal?: AbortSignal,
): Promise<RouteResponse> {
  const params = new URLSearchParams({ to: `${destLon},${destLat}` });
  if (miles !== undefined) params.set("miles", String(miles));
  if (originLon !== undefined && originLat !== undefined) {
    params.set("origin", `${originLon},${originLat}`);
  }
  for (const [lon, lat] of (viaCoords ?? [])) {
    params.append("via", `${lon},${lat}`);
  }
  if (mode && mode !== "drive") params.set("mode", mode);
  const res = await fetchWithTimeout(
    `${API_BASE}/route?${params}`,
    ROUTE_TIMEOUT_MS,
    signal,
  );
  if (!res.ok) await _throwFromResponse(res, `Route failed: ${res.status}`);
  return res.json();
}
