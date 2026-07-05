export type PlaceCategory = "history" | "art" | "scenic" | "culture" | "civic";

export interface TourStop {
  order: number;
  name: string;
  coordinates: [number, number];
  category: PlaceCategory;
  description: string;
  poi_id?: string;
  // Curator review state of a generated description. Absent on hand-authored
  // gallery tours, which must never be labeled as drafts.
  review_status?: string | null;
}

export interface TourRouteFeature {
  type: "Feature";
  geometry: {
    type: "LineString";
    coordinates: number[][];
  };
  properties: Record<string, unknown>;
}

export interface TourDefinition {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  mode: "walk" | "drive";
  distance_miles: number;
  duration_minutes: number;
  stop_count: number;
  route: TourRouteFeature;
  stops: TourStop[];
}

export interface TourSummary {
  slug: string;
  name: string;
  tagline: string;
  mode: "walk" | "drive";
  distance_miles: number;
  duration_minutes: number;
  stop_count: number;
}
