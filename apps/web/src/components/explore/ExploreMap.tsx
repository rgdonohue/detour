import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { getConfig } from "../../lib/api";
import type { PoiFeature, PoisResponse } from "../../lib/api";
import type { PlaceCategory } from "../../data/places";

const TONER_LITE_URL =
  "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";

const POI_SOURCE_ID = "pois";
const POI_CIRCLE_LAYER_ID = "poi-circles";

const ALL_CATEGORIES: PlaceCategory[] = ["history", "art", "scenic", "culture", "civic"];

const POI_CATEGORY_COLOR_EXPR = [
  "match", ["get", "category"],
  "history", "#9b6b4a",
  "art",     "#8b5e8b",
  "scenic",  "#5a8a6a",
  "culture", "#c2783c",
  "civic",   "#6a7d99",
  "#999999",
] as maplibregl.ExpressionSpecification;

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
  };
}

interface ExploreMapProps {
  activeCategories: Set<PlaceCategory>;
  onPoiSelect: (poi: SelectedPoi | null) => void;
  pois: PoisResponse | null;
  flyToRef?: { current: (coords: [number, number]) => void };
}

function buildCategoryFilter(
  active: Set<PlaceCategory>,
): maplibregl.FilterSpecification | null {
  if (active.size === ALL_CATEGORIES.length) return null; // all on — no filter needed
  if (active.size === 0) return ["==", "1", "0"]; // nothing visible
  return ["in", ["get", "category"], ["literal", Array.from(active)]];
}

export function ExploreMap({ activeCategories, onPoiSelect, pois, flyToRef }: ExploreMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const activeCategoriesRef = useRef<Set<PlaceCategory>>(activeCategories);
  activeCategoriesRef.current = activeCategories;
  const onPoiSelectRef = useRef(onPoiSelect);
  onPoiSelectRef.current = onPoiSelect;
  const [mapLoaded, setMapLoaded] = useState(false);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    getConfig()
      .then((config) => {
        if (!containerRef.current) return;
        const [lon, lat] = config.coordinates;

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: {
            version: 8,
            glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
            sources: {
              "toner-lite": {
                type: "raster",
                tiles: [TONER_LITE_URL],
                tileSize: 256,
                attribution:
                  '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
              },
            },
            layers: [{ id: "toner-lite", type: "raster", source: "toner-lite" }],
          },
          center: [lon, lat],
          zoom: 13,
        });

        map.dragRotate.disable();
        map.touchZoomRotate.disableRotation();
        mapRef.current = map;

        if (flyToRef) {
          flyToRef.current = (coords: [number, number]) => {
            map.flyTo({ center: coords, zoom: 16, duration: 700 });
          };
        }

        map.on("load", () => setMapLoaded(true));
      })
      .catch((err) => console.warn("Failed to load config:", err));

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Add POI source + layer once map is loaded and pois data has arrived
  useEffect(() => {
    if (!mapLoaded || !pois || !mapRef.current) return;
    const map = mapRef.current;
    if (map.getSource(POI_SOURCE_ID)) return; // already added; no-op on re-render

    map.addSource(POI_SOURCE_ID, { type: "geojson", data: pois });

    map.addLayer({
      id: POI_CIRCLE_LAYER_ID,
      type: "circle",
      source: POI_SOURCE_ID,
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          12, 3,
          14, 5,
          16, 7,
        ],
        "circle-color": POI_CATEGORY_COLOR_EXPR,
        "circle-opacity": [
          "interpolate", ["linear"], ["zoom"],
          12, 0.6,
          15, 0.85,
        ],
        "circle-stroke-width": 1,
        "circle-stroke-color": "rgba(255,255,255,0.8)",
      },
    });

    const initialFilter = buildCategoryFilter(activeCategoriesRef.current);
    if (initialFilter) map.setFilter(POI_CIRCLE_LAYER_ID, initialFilter);

    const hoverPopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 10,
      anchor: "bottom",
      className: "explore-hover-popup",
    });

    const handleMouseEnter = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features?.length) return;
      map.getCanvas().style.cursor = "pointer";
      const coords = (e.features[0].geometry as GeoJSON.Point).coordinates as [number, number];
      const props = e.features[0].properties as { name: string; description_map: string | null };
      const html = props.description_map
        ? `<strong>${props.name}</strong><br><span style="font-size:0.85em;opacity:0.85">${props.description_map}</span>`
        : props.name;
      hoverPopup.setLngLat(coords).setHTML(html).addTo(map);
    };

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = "";
      hoverPopup.remove();
    };

    const handlePoiClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features?.length) return;
      onPoiSelectRef.current(featureToSelectedPoi(e.features[0] as unknown as PoiFeature));
    };

    map.on("mouseenter", POI_CIRCLE_LAYER_ID, handleMouseEnter);
    map.on("mouseleave", POI_CIRCLE_LAYER_ID, handleMouseLeave);
    map.on("click", POI_CIRCLE_LAYER_ID, handlePoiClick);

    map.on("click", (e) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: [POI_CIRCLE_LAYER_ID] });
      if (!hits.length) onPoiSelectRef.current(null);
    });
  }, [mapLoaded, pois]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync category filter when activeCategories prop changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(POI_CIRCLE_LAYER_ID)) return;
    const filter = buildCategoryFilter(activeCategories);
    map.setFilter(POI_CIRCLE_LAYER_ID, filter);
  }, [activeCategories]);

  return <div ref={containerRef} className="map-container" />;
}
