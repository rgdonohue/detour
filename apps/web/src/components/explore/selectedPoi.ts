import type { PoiFeature } from "../../lib/api";

export interface SelectedPoi {
  name: string;
  category: string;
  wikipedia_title: string | null;
  coordinates: [number, number];
  description_map: string | null;
  description_card: string | null;
  subcategory: string | null;
  confidence: string | null;
  basis: string | null;
  address: string | null;
  review_status: string | null;
}

export function featureToSelectedPoi(feature: PoiFeature): SelectedPoi {
  const props = feature.properties;
  return {
    name: props.name,
    category: props.category,
    wikipedia_title: props.wikipedia_title,
    coordinates: feature.geometry.coordinates,
    description_map: props.description_map,
    description_card: props.description_card,
    subcategory: props.subcategory,
    confidence: props.confidence,
    basis: props.basis,
    address: props.address,
    review_status: props.review_status,
  };
}
