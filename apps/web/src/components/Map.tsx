import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { getConfig, type Config } from "../lib/api";
import { useServiceArea } from "../hooks/useServiceArea";
import { useRouteCheck } from "../hooks/useRouteCheck";
import { VerdictPanel } from "./VerdictPanel";

const CLICK_DEBOUNCE_MS = 300;
const TONER_LITE_URL =
  "https://tiles.stadiamaps.com/tiles/stamen_toner_lite/{z}/{x}/{y}.png";

const ROUTE_WITHIN_COLOR = "#2D7D46";
const ROUTE_OUTSIDE_COLOR = "#B8432F";

/** Fallback when API is unavailable — Capitol coordinates */
const FALLBACK_CONFIG: Config = {
  hotel_name: "New Mexico State Capitol",
  address: "411 South Capitol St, Santa Fe, NM 87501",
  coordinates: [-105.9384, 35.6824],
  default_miles: 3,
  max_miles: 5,
};

export function Map() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);
  const isCheckingRef = useRef(false);
  const [config, setConfig] = useState<Config | null>(null);
  const { polygon } = useServiceArea(3);
  const {
    checkRoute,
    clearResult,
    result,
    isLoading,
    error,
  } = useRouteCheck();

  // Fetch config and init map; fallback to hardcoded config if API unreachable
  useEffect(() => {
    let cancelled = false;

    getConfig()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => {
        if (!cancelled) {
          // API likely not running — use fallback so map at least loads
          setConfig(FALLBACK_CONFIG);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const removeRouteAndDestination = useCallback(() => {
    const map = mapRef.current;
    if (destMarkerRef.current) {
      destMarkerRef.current.remove();
      destMarkerRef.current = null;
    }
    if (map) {
      if (map.getLayer("route-line")) map.removeLayer("route-line");
      if (map.getSource("route")) map.removeSource("route");
    }
  }, []);

  const handleReset = useCallback(() => {
    removeRouteAndDestination();
    clearResult();
    const map = mapRef.current;
    const cfg = config;
    if (map && cfg) {
      const [lon, lat] = cfg.coordinates;
      map.flyTo({ center: [lon, lat], zoom: 13 });
    }
  }, [removeRouteAndDestination, clearResult, config]);

  // Create map when config is ready
  useEffect(() => {
    if (!config || !containerRef.current) return;

    const [lon, lat] = config.coordinates;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          "toner-lite": {
            type: "raster",
            tiles: [TONER_LITE_URL],
            tileSize: 256,
          },
        },
        layers: [
          {
            id: "toner-lite",
            type: "raster",
            source: "toner-lite",
          },
        ],
      },
      center: [lon, lat],
      zoom: 13,
    });

    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();

    mapRef.current = map;

    return () => {
      if (destMarkerRef.current) {
        destMarkerRef.current.remove();
        destMarkerRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
  }, [config]);

  // Add polygon layers when data is ready
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !polygon?.features?.length) return;

    const sourceId = "service-area";
    const fillLayerId = "service-area-fill";
    const lineLayerId = "service-area-line";

    const addLayers = () => {
      if (map.getSource(sourceId)) {
        (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(polygon);
        if (map.getLayer(fillLayerId)) {
          map.setPaintProperty(fillLayerId, "fill-opacity", 0.12);
        }
        return;
      }
      map.addSource(sourceId, {
        type: "geojson",
        data: polygon,
      });
      map.addLayer({
        id: fillLayerId,
        type: "fill",
        source: sourceId,
        paint: {
          "fill-color": "#C45B28",
          "fill-opacity": 0.12,
        },
      });
      map.addLayer({
        id: lineLayerId,
        type: "line",
        source: sourceId,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#C45B28",
          "line-width": 2,
          "line-dasharray": [2, 1],
        },
      });
    };

    const run = () => {
      map.off("load", run);
      addLayers();
    };
    if (map.isStyleLoaded()) {
      addLayers();
    } else {
      map.on("load", run);
    }
  }, [polygon, config]);

  // Add origin marker when map and config are ready
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !config) return;

    const [lon, lat] = config.coordinates;

    const el = document.createElement("div");
    el.className = "origin-marker";
    const img = document.createElement("img");
    img.src = "/origin-marker.svg";
    img.alt = `${config.hotel_name} — ${config.address}`;
    img.width = 24;
    img.height = 36;
    img.style.pointerEvents = "none";
    el.appendChild(img);
    el.style.cursor = "pointer";

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([lon, lat])
      .addTo(map);

    const popup = new maplibregl.Popup({ offset: 12, closeButton: true })
      .setHTML(
        `<div class="origin-popup"><strong>${config.hotel_name}</strong><br/>${config.address}</div>`
      );

    el.addEventListener("click", (e) => {
      e.stopPropagation();
      marker.setPopup(popup);
      popup.addTo(map);
    });

    return () => {
      marker.remove();
    };
  }, [config]);

  // Crosshair cursor when hovering over polygon
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onMove = (e: maplibregl.MapMouseEvent) => {
      try {
        const features = map.queryRenderedFeatures(e.point, {
          layers: ["service-area-fill", "service-area-line"],
        });
        const canvas = map.getCanvas();
        canvas.style.cursor = features.length > 0 ? "crosshair" : "";
      } catch {
        // Layers may not exist yet
      }
    };

    map.on("mousemove", onMove);
    return () => {
      map.off("mousemove", onMove);
    };
  }, [polygon]);

  // Map click handler: fetch route (debounced 300ms)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !config) return;

    let clickTimeout: ReturnType<typeof setTimeout> | null = null;

    const onMapClick = (e: maplibregl.MapMouseEvent) => {
      if (isCheckingRef.current || isLoading) return;
      const { lng, lat } = e.lngLat;

      if (clickTimeout) clearTimeout(clickTimeout);
      clickTimeout = setTimeout(() => {
        clickTimeout = null;
        if (isCheckingRef.current || isLoading) return;
        isCheckingRef.current = true;

        removeRouteAndDestination();

        checkRoute(lng, lat)
        .then((data) => {
          const m = mapRef.current;
          if (!m) return;

          // Add destination marker
          const el = document.createElement("div");
          el.className = "dest-marker";
          el.style.width = "16px";
          el.style.height = "16px";
          el.style.borderRadius = "50%";
          el.style.backgroundColor = data.within_limit
            ? ROUTE_WITHIN_COLOR
            : ROUTE_OUTSIDE_COLOR;
          el.style.border = "2px solid white";
          el.style.boxShadow = "0 1px 3px rgba(0,0,0,0.3)";

          const destMarker = new maplibregl.Marker({ element: el })
            .setLngLat([lng, lat])
            .addTo(m);
          destMarkerRef.current = destMarker;

          // Add route line
          const routeColor = data.within_limit
            ? ROUTE_WITHIN_COLOR
            : ROUTE_OUTSIDE_COLOR;

          if (m.getSource("route")) {
            (m.getSource("route") as maplibregl.GeoJSONSource).setData(
              data.route as GeoJSON.Feature
            );
            if (m.getLayer("route-line")) {
              m.setPaintProperty("route-line", "line-color", routeColor);
            }
          } else {
            m.addSource("route", {
              type: "geojson",
              data: data.route as GeoJSON.Feature,
            });
            m.addLayer({
              id: "route-line",
              type: "line",
              source: "route",
              layout: { "line-join": "round", "line-cap": "round" },
              paint: {
                "line-color": routeColor,
                "line-width": 4,
                "line-opacity": 0.9,
              },
            });
          }
        })
        .catch(() => {
          removeRouteAndDestination();
        })
        .finally(() => {
          isCheckingRef.current = false;
        });
      }, CLICK_DEBOUNCE_MS);
    };

    map.on("click", onMapClick);
    return () => {
      if (clickTimeout) clearTimeout(clickTimeout);
      map.off("click", onMapClick);
    };
  }, [config, checkRoute, isLoading, removeRouteAndDestination]);

  if (!config) {
    return <div className="map-loading">Loading map…</div>;
  }

  const showVerdictPanel = isLoading || result !== null || error !== null;

  return (
    <div
      className={`map-wrapper ${isLoading ? "map-wrapper--loading" : ""}`}
    >
      <div ref={containerRef} className="map-container" />
      {showVerdictPanel && (
        <VerdictPanel
          distance_miles={result?.distance_miles ?? 0}
          within_limit={result?.within_limit ?? false}
          isLoading={isLoading}
          error={error}
          onReset={handleReset}
        />
      )}
    </div>
  );
}
