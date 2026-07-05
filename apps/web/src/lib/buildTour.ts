import type { TourDefinition, TourStop, PlaceCategory } from "../types/tour";
import type { RouteResponse, StopSuggestion, TravelMode } from "./api";

const CATEGORY_LABELS: Record<string, string> = {
  history: "Historic",
  art: "Art",
  scenic: "Scenic",
  culture: "Culture",
  civic: "Landmark",
  historic: "Historic",
  arts_and_culture: "Arts & Culture",
  leisure_and_entertainment: "Leisure",
  natural: "Natural",
  sustenance: "Food & Drink",
  tourism: "Tourism",
  public_places: "Public Place",
};

const ORS_TO_PLACE_CATEGORY: Record<string, PlaceCategory> = {
  historic: "history",
  arts_and_culture: "art",
  leisure_and_entertainment: "culture",
  natural: "scenic",
  tourism: "civic",
  public_places: "civic",
  accommodation: "civic",
  education: "culture",
};

const PLACE_CATEGORIES = new Set<string>(["history", "art", "scenic", "culture", "civic"]);

function toPlaceCategory(cat: string): PlaceCategory {
  if (PLACE_CATEGORIES.has(cat)) return cat as PlaceCategory;
  return ORS_TO_PLACE_CATEGORY[cat] ?? "civic";
}

function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] ?? cat;
}

function firstNonEmpty(...vals: (string | null | undefined)[]): string {
  return vals.find((v) => v != null && v !== "") ?? "";
}

export interface BuildTourInput {
  origin: [number, number];
  destination: [number, number];
  mode: TravelMode;
  route: RouteResponse["route"];
  distance_miles: number;
  duration_seconds: number;
  stops: StopSuggestion[];
}

export function buildTourFromState({
  mode,
  route,
  distance_miles,
  duration_seconds,
  stops,
}: BuildTourInput): TourDefinition {
  const slug = `preview-${Date.now()}`;
  const modeLabel = mode === "walk" ? "Walking" : "Driving";
  const stopWord = stops.length === 1 ? "stop" : "stops";
  const tagline = `${modeLabel} · ${distance_miles.toFixed(1)} mi · ${stops.length} ${stopWord}`;

  const tourStops: TourStop[] = stops.map((stop, i) => {
    const cat = toPlaceCategory(stop.category);
    const catLabel = categoryLabel(stop.category);
    const addrPart = stop.address?.trim() ?? "";

    const description = firstNonEmpty(
      stop.description_card,
      stop.description,
      stop.description_map,
      addrPart ? `${catLabel} · ${addrPart}` : "",
      catLabel,
    );

    return {
      order: i + 1,
      name: stop.name,
      coordinates: stop.coordinates,
      category: cat,
      description,
      poi_id: stop.poi_id ?? undefined,
      review_status: stop.review_status ?? undefined,
    };
  });

  return {
    slug,
    name: "Your route",
    tagline,
    description: "",
    mode: mode === "walk" ? "walk" : "drive",
    distance_miles,
    duration_minutes: Math.round(duration_seconds / 60),
    stop_count: stops.length,
    route: {
      type: "Feature",
      geometry: route.geometry,
      properties: route.properties,
    },
    stops: tourStops,
  };
}
