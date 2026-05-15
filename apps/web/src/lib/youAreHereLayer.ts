import maplibregl from "maplibre-gl";

const SOURCE_ID = "you-are-here";
const LAYER_ID = "you-are-here-dot";
const HALO_LAYER_ID = "you-are-here-halo";

/**
 * Adds, updates, or removes the "you are here" pulse dot on a MapLibre map.
 * Pass null coords to remove. Safe to call repeatedly.
 */
export function setYouAreHereLayer(
  map: maplibregl.Map,
  coords: [number, number] | null,
): void {
  if (!coords) {
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getLayer(HALO_LAYER_ID)) map.removeLayer(HALO_LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    return;
  }

  const feature: GeoJSON.Feature<GeoJSON.Point> = {
    type: "Feature",
    geometry: { type: "Point", coordinates: coords },
    properties: {},
  };

  const existing = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(feature);
    return;
  }

  map.addSource(SOURCE_ID, { type: "geojson", data: feature });
  map.addLayer({
    id: HALO_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    paint: {
      "circle-radius": 14,
      "circle-color": "#2B8E8E",
      "circle-opacity": 0.18,
    },
  });
  map.addLayer({
    id: LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    paint: {
      "circle-radius": 6,
      "circle-color": "#2B8E8E",
      "circle-stroke-color": "#FAF7F2",
      "circle-stroke-width": 2,
    },
  });
}
