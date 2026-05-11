import type { PlaceCategory } from "../data/places";
import type { TravelMode } from "./api";

export interface ShareableRouteState {
  origin: [number, number] | null;
  destination: [number, number] | null;
  category: PlaceCategory[] | null;
  via: [number, number][];
  mode: TravelMode;
}

const CATEGORY_VALUES: readonly PlaceCategory[] = [
  "history",
  "art",
  "scenic",
  "culture",
  "civic",
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

function parseCategories(value: string | null): PlaceCategory[] | null {
  if (!value) return null;
  const cats = value
    .split(",")
    .filter((v): v is PlaceCategory => CATEGORY_VALUES.includes(v as PlaceCategory));
  return cats.length > 0 ? cats : null;
}

function formatCoord(value: number): string {
  return value.toFixed(5).replace(/\.?0+$/, "");
}

function encodeCoord(coord: [number, number]): string {
  return `${formatCoord(coord[0])},${formatCoord(coord[1])}`;
}

function parseVia(value: string | null): [number, number][] {
  if (!value) return [];
  return value
    .split(";")
    .map((pair) => parseCoord(pair))
    .filter((c): c is [number, number] => c !== null);
}

export function parseShareableRouteState(): ShareableRouteState {
  const params = new URLSearchParams(window.location.search);
  return {
    origin: parseCoord(params.get("origin")),
    destination: parseCoord(params.get("destination")),
    category: parseCategories(params.get("category")),
    via: parseVia(params.get("via")),
    mode: params.get("mode") === "drive" ? "drive" : "walk",
  };
}

export function replaceShareableRouteState(state: ShareableRouteState): void {
  const params = new URLSearchParams();

  if (state.origin) params.set("origin", encodeCoord(state.origin));
  if (state.destination) params.set("destination", encodeCoord(state.destination));

  const hasResolvedRoute = state.destination !== null;
  if (hasResolvedRoute && state.category && state.category.length < CATEGORY_VALUES.length) {
    params.set("category", state.category.join(","));
  }
  if (hasResolvedRoute && state.via.length > 0) {
    params.set("via", state.via.map(encodeCoord).join(";"));
  }
  params.set("mode", state.mode);

  const nextSearch = params.toString();
  const nextUrl = nextSearch.length > 0
    ? `${window.location.pathname}?${nextSearch}${window.location.hash}`
    : `${window.location.pathname}${window.location.hash}`;

  window.history.replaceState(null, "", nextUrl);
}
