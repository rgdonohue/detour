import type { PlaceCategory } from "../data/places";
import type { TravelMode } from "./api";

export interface ShareableRouteState {
  origin: [number, number] | null;
  destination: [number, number] | null;
  category: PlaceCategory | null;
  detour: boolean;
  mode: TravelMode;
}

const CATEGORY_VALUES: readonly PlaceCategory[] = [
  "history",
  "art",
  "food",
  "scenic",
  "culture",
];

function parseCoord(value: string | null): [number, number] | null {
  if (!value) return null;
  const parts = value.split(",");
  if (parts.length !== 2) return null;
  const lon = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return [lon, lat];
}

function normalizeCategory(value: string | null): PlaceCategory | null {
  if (!value) return null;
  return CATEGORY_VALUES.includes(value as PlaceCategory)
    ? (value as PlaceCategory)
    : null;
}

function formatCoord(value: number): string {
  return value.toFixed(5).replace(/\.?0+$/, "");
}

function encodeCoord(coord: [number, number]): string {
  return `${formatCoord(coord[0])},${formatCoord(coord[1])}`;
}

export function parseShareableRouteState(): ShareableRouteState {
  const params = new URLSearchParams(window.location.search);
  return {
    origin: parseCoord(params.get("origin")),
    destination: parseCoord(params.get("destination")),
    category: normalizeCategory(params.get("category")),
    detour: params.get("detour") === "1",
    mode: params.get("mode") === "drive" ? "drive" : "walk",
  };
}

export function replaceShareableRouteState(state: ShareableRouteState): void {
  const params = new URLSearchParams();

  if (state.origin) params.set("origin", encodeCoord(state.origin));
  if (state.destination) params.set("destination", encodeCoord(state.destination));

  const hasResolvedRoute = state.destination !== null;
  if (hasResolvedRoute && state.category) params.set("category", state.category);
  if (hasResolvedRoute && state.detour) params.set("detour", "1");
  if (state.mode === "drive") params.set("mode", "drive");

  const nextSearch = params.toString();
  const nextUrl = nextSearch.length > 0
    ? `${window.location.pathname}?${nextSearch}${window.location.hash}`
    : `${window.location.pathname}${window.location.hash}`;

  window.history.replaceState(null, "", nextUrl);
}
