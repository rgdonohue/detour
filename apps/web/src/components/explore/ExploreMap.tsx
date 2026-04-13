import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { getConfig, getPois } from "../../lib/api";
import type { PlaceCategory } from "../../data/places";

const TONER_LITE_URL =
  "https://tiles.stadiamaps.com/tiles/stamen_toner_lite/{z}/{x}/{y}.png";

const POI_SOURCE_ID = "pois";
const POI_CIRCLE_LAYER_ID = "poi-circles";
const POI_LABEL_LAYER_ID = "poi-labels";

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
}

interface ExploreMapProps {
  activeCategories: Set<PlaceCategory>;
  onPoiSelect: (poi: SelectedPoi | null) => void;
}

function buildCategoryFilter(
  active: Set<PlaceCategory>,
): maplibregl.FilterSpecification | null {
  if (active.size === ALL_CATEGORIES.length) return null; // all on — no filter needed
  if (active.size === 0) return ["==", "1", "0"]; // nothing visible
  return ["in", ["get", "category"], ["literal", Array.from(active)]];
}

export function ExploreMap({ activeCategories, onPoiSelect }: ExploreMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const activeCategoriesRef = useRef<Set<PlaceCategory>>(activeCategories);
  activeCategoriesRef.current = activeCategories;

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let map: maplibregl.Map;

    getConfig()
      .then((config) => {
        if (!containerRef.current) return;
        const [lon, lat] = config.coordinates;

        map = new maplibregl.Map({
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
                  '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://stamen.com/">Stamen Design</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
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

        map.on("load", () => {
          getPois()
            .then((geojson) => {
              if (!mapRef.current) return;

              map.addSource(POI_SOURCE_ID, { type: "geojson", data: geojson });

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

              map.addLayer({
                id: POI_LABEL_LAYER_ID,
                type: "symbol",
                source: POI_SOURCE_ID,
                minzoom: 14,
                layout: {
                  "text-field": ["get", "name"],
                  "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
                  "text-size": [
                    "interpolate", ["linear"], ["zoom"],
                    14, 11,
                    16, 13,
                  ],
                  "text-offset": [0, 1.2],
                  "text-anchor": "top",
                  "text-allow-overlap": false,
                  "text-optional": true,
                  "symbol-sort-key": ["-", 100, ["get", "quality_score"]],
                },
                paint: {
                  "text-color": "#2c1810",
                  "text-halo-color": "rgba(250, 247, 242, 0.9)",
                  "text-halo-width": 1.5,
                },
              });

              // Apply initial filter
              const initialFilter = buildCategoryFilter(activeCategoriesRef.current);
              if (initialFilter) {
                map.setFilter(POI_CIRCLE_LAYER_ID, initialFilter);
                map.setFilter(POI_LABEL_LAYER_ID, initialFilter);
              }

              // Hover tooltip — name only
              const hoverPopup = new maplibregl.Popup({
                closeButton: false,
                closeOnClick: false,
                offset: 10,
                anchor: "bottom",
                className: "stop-tooltip-popup", // reuse existing tooltip style
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

              // Click — open detail in sidebar
              const handlePoiClick = (e: maplibregl.MapLayerMouseEvent) => {
                if (!e.features?.length) return;
                const f = e.features[0];
                const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
                const props = f.properties as {
                  name: string;
                  category: string;
                  wikipedia_title: string | null;
                  description_map: string | null;
                  description_card: string | null;
                  subcategory: string | null;
                  confidence: string | null;
                  basis: string | null;
                };
                onPoiSelect({
                  name: props.name,
                  category: props.category,
                  wikipedia_title: props.wikipedia_title,
                  coordinates: coords,
                  description_map: props.description_map,
                  description_card: props.description_card,
                  subcategory: props.subcategory,
                  confidence: props.confidence,
                  basis: props.basis,
                });
              };

              for (const layerId of [POI_CIRCLE_LAYER_ID, POI_LABEL_LAYER_ID]) {
                map.on("mouseenter", layerId, handleMouseEnter);
                map.on("mouseleave", layerId, handleMouseLeave);
                map.on("click", layerId, handlePoiClick);
              }
            })
            .catch((err) => console.warn("Failed to load POI layer:", err));
        });
      })
      .catch((err) => console.warn("Failed to load config:", err));

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync category filter when activeCategories prop changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(POI_CIRCLE_LAYER_ID)) return;
    const filter = buildCategoryFilter(activeCategories);
    map.setFilter(POI_CIRCLE_LAYER_ID, filter);
    map.setFilter(POI_LABEL_LAYER_ID, filter);
  }, [activeCategories]);

  return <div ref={containerRef} className="map-container" />;
}
