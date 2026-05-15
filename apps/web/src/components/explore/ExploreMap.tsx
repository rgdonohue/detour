import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { getConfig } from "../../lib/api";
import type { Config, PoiFeature, PoisResponse } from "../../lib/api";
import type { PlaceCategory } from "../../data/places";
import { useGeolocate } from "../../hooks/useGeolocate";
import { LocateControl } from "../LocateControl";
import { setYouAreHereLayer } from "../../lib/youAreHereLayer";

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

function buildPopupHtml(name: string, description: string | null): string {
  return description
    ? `<strong>${name}</strong><br><span style="font-size:0.85em;opacity:0.85">${description}</span>`
    : name;
}

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
  focusPoiRef?: { current: (feature: PoiFeature) => void };
  geolocateRef?: { current: () => void };
}

function buildCategoryFilter(
  active: Set<PlaceCategory>,
): maplibregl.FilterSpecification | null {
  if (active.size === ALL_CATEGORIES.length) return null;
  if (active.size === 0) return ["==", "1", "0"];
  return ["in", ["get", "category"], ["literal", Array.from(active)]];
}

export function ExploreMap({ activeCategories, onPoiSelect, pois, focusPoiRef, geolocateRef }: ExploreMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const activeCategoriesRef = useRef<Set<PlaceCategory>>(activeCategories);
  activeCategoriesRef.current = activeCategories;
  const onPoiSelectRef = useRef(onPoiSelect);
  onPoiSelectRef.current = onPoiSelect;
  const [mapLoaded, setMapLoaded] = useState(false);

  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => {
    let cancelled = false;
    getConfig().then((c) => { if (!cancelled) setConfig(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const geo = useGeolocate({
    centerCoords: config?.coordinates ?? [-105.9384, 35.6824],
    maxMiles: config?.max_miles ?? 5,
  });

  const [geoNotice, setGeoNotice] = useState<string | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (geo.state === "ok" && geo.coords) {
      map.easeTo({ center: geo.coords, zoom: 15, duration: 800 });
      setYouAreHereLayer(map, geo.coords);
      setGeoNotice(null);
    } else if (geo.state === "out-of-range" && geo.coords) {
      setYouAreHereLayer(map, geo.coords);
      setGeoNotice("You're not in Santa Fe — showing the city center.");
    } else if (geo.state === "denied") {
      setGeoNotice("Location permission denied. Enable it in your browser settings.");
    } else if (geo.state === "unavailable") {
      setGeoNotice("Couldn't get your location.");
    }
  }, [geo.state, geo.coords]);

  useEffect(() => {
    if (!geoNotice) return;
    const t = setTimeout(() => setGeoNotice(null), 4000);
    return () => clearTimeout(t);
  }, [geoNotice]);

  // Expose request() to the parent for the banner
  useEffect(() => {
    if (geolocateRef) geolocateRef.current = geo.request;
  }, [geolocateRef, geo.request]);

  const hoverPopupRef = useRef<maplibregl.Popup | null>(null);
  const fadeStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFadeTimers = () => {
    if (fadeStartTimerRef.current) {
      clearTimeout(fadeStartTimerRef.current);
      fadeStartTimerRef.current = null;
    }
    if (removeTimerRef.current) {
      clearTimeout(removeTimerRef.current);
      removeTimerRef.current = null;
    }
    hoverPopupRef.current?.getElement()?.classList.remove("explore-hover-popup--fade-out");
  };

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

        if (focusPoiRef) {
          focusPoiRef.current = (feature: PoiFeature) => {
            const coords = feature.geometry.coordinates as [number, number];
            map.flyTo({ center: coords, zoom: 16, duration: 700 });
            const popup = hoverPopupRef.current;
            if (!popup) return;
            clearFadeTimers();
            popup
              .setLngLat(coords)
              .setHTML(buildPopupHtml(feature.properties.name, feature.properties.description_map))
              .addTo(map);
            fadeStartTimerRef.current = setTimeout(() => {
              popup.getElement()?.classList.add("explore-hover-popup--fade-out");
              removeTimerRef.current = setTimeout(() => {
                popup.remove();
                popup.getElement()?.classList.remove("explore-hover-popup--fade-out");
              }, 320);
            }, 4000);
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
    if (map.getSource(POI_SOURCE_ID)) return;

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

    hoverPopupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 10,
      anchor: "bottom",
      className: "explore-hover-popup",
    });

    const handleMouseEnter = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features?.length) return;
      const popup = hoverPopupRef.current;
      if (!popup) return;
      clearFadeTimers();
      map.getCanvas().style.cursor = "pointer";
      const coords = (e.features[0].geometry as GeoJSON.Point).coordinates as [number, number];
      const props = e.features[0].properties as { name: string; description_map: string | null };
      popup.setLngLat(coords).setHTML(buildPopupHtml(props.name, props.description_map)).addTo(map);
    };

    const handleMouseLeave = () => {
      clearFadeTimers();
      map.getCanvas().style.cursor = "";
      hoverPopupRef.current?.remove();
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
      if (!hits.length) {
        onPoiSelectRef.current(null);
        clearFadeTimers();
        hoverPopupRef.current?.remove();
      }
    });
  }, [mapLoaded, pois]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync category filter when activeCategories prop changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(POI_CIRCLE_LAYER_ID)) return;
    const filter = buildCategoryFilter(activeCategories);
    map.setFilter(POI_CIRCLE_LAYER_ID, filter);
  }, [activeCategories]);

  return (
    <>
      <div ref={containerRef} className="map-container" />
      <LocateControl map={mapRef.current} state={geo.state} onClick={geo.request} />
      {geoNotice && <div className="geo-notice">{geoNotice}</div>}
    </>
  );
}
