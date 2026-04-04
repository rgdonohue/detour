import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getConfig,
  getRoute,
  suggestStop,
  type Config,
  type RouteResponse,
  type StopSuggestion,
  type TravelMode,
} from "../lib/api";
import { useServiceArea } from "../hooks/useServiceArea";
import { useRouteCheck, type RouteCheckResult } from "../hooks/useRouteCheck";
import { VerdictPanel } from "./VerdictPanel";
import { ModeToggle } from "./ModeToggle";
import type { PlaceCategory } from "../data/places";
import {
  parseShareableRouteState,
  replaceShareableRouteState,
} from "../lib/urlState";

const CLICK_DEBOUNCE_MS = 300;
const TONER_LITE_URL =
  "https://tiles.stadiamaps.com/tiles/stamen_toner_lite/{z}/{x}/{y}.png";

const ROUTE_COLOR = "#C45B28";       // terracotta — used for all routes
const ROUTE_OUTSIDE_COLOR = "#B8432F"; // outside-limit override

/** Effective distance limit for route verdict + stop search, based on mode */
function effectiveMilesFor(m: TravelMode): number {
  return m === "walk" ? 2 : 5;
}

/** Ring distances shown on map, based on mode */
function ringMilesFor(m: TravelMode): number[] {
  return m === "walk" ? [0.5, 1, 2] : [1, 3, 5];
}

/** Fallback when API is unavailable — Capitol coordinates */
const FALLBACK_CONFIG: Config = {
  origin_name: "New Mexico State Capitol",
  address: "411 South Capitol St, Santa Fe, NM 87501",
  coordinates: [-105.9384, 35.6824],
  default_miles: 3,
  max_miles: 5,
};

type ClickPhase = "set-origin" | "set-destination" | "route-shown";

interface MapProps {
  resetRef?: { current: () => void };
  mode: TravelMode;
  onModeChange: (mode: TravelMode) => void;
}

function toRouteCheckResult(
  data: Pick<
    RouteResponse,
    "route" | "distance_miles" | "duration_seconds" | "within_limit"
  >,
): RouteCheckResult {
  return {
    route: data.route,
    distance_miles: data.distance_miles,
    duration_seconds: data.duration_seconds,
    within_limit: data.within_limit,
  };
}

export function Map({ resetRef, mode, onModeChange }: MapProps) {
  const initialShareStateRef = useRef(parseShareableRouteState());
  const restoreStartedRef = useRef(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const originMarkerRef = useRef<maplibregl.Marker | null>(null);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);
  const stopMarkersRef = useRef<maplibregl.Marker[]>([]);
  const stopPopupRef = useRef<maplibregl.Popup | null>(null);
  const isCheckingRef = useRef(false);
  const detourStopKeyRef = useRef<string | null>(null);
  const onStopClickRef = useRef<(stop: StopSuggestion) => void>(() => {});

  const [config, setConfig] = useState<Config | null>(null);
  const [clickPhase, setClickPhase] = useState<ClickPhase>("set-origin");
  const [origin, setOrigin] = useState<[number, number] | null>(null);
  const [destination, setDestination] = useState<[number, number] | null>(null);
  const [nearbyStops, setNearbyStops] = useState<StopSuggestion[]>([]);
  const [selectedStop, setSelectedStop] = useState<StopSuggestion | null>(null);
  const [stopLoading, setStopLoading] = useState(false);
  const [stopCategory, setStopCategory] = useState<PlaceCategory | null>(null);
  const [detourResult, setDetourResult] = useState<RouteCheckResult | null>(null);
  const [showingDetour, setShowingDetour] = useState(false);
  const [detourLoading, setDetourLoading] = useState(false);
  const [restoreReady, setRestoreReady] = useState(false);

  const { polygon } = useServiceArea(origin?.[0], origin?.[1], mode);
  const { checkRoute, clearResult, result, isLoading, error } = useRouteCheck();

  useEffect(() => {
    let cancelled = false;
    getConfig()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => {
        if (!cancelled) setConfig(FALLBACK_CONFIG);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const removeAltRoute = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.getLayer("route-alt-line")) map.removeLayer("route-alt-line");
    if (map.getSource("route-alt")) map.removeSource("route-alt");
  }, []);

  const renderRouteLine = useCallback(
    (
      feature: RouteResponse["route"],
      color: string,
      sourceId: "route" | "route-alt",
      layerId: "route-line" | "route-alt-line",
      opacity: number,
      width: number,
      dasharray?: number[],
    ) => {
      const map = mapRef.current;
      if (!map) return;

      if (map.getSource(sourceId)) {
        (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(
          feature as GeoJSON.Feature,
        );
      } else {
        map.addSource(sourceId, {
          type: "geojson",
          data: feature as GeoJSON.Feature,
        });
      }

      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": color,
            "line-width": width,
            "line-opacity": opacity,
            ...(dasharray ? { "line-dasharray": dasharray } : {}),
          },
        });
        return;
      }

      map.setPaintProperty(layerId, "line-color", color);
      map.setPaintProperty(layerId, "line-width", width);
      map.setPaintProperty(layerId, "line-opacity", opacity);
      map.setPaintProperty(layerId, "line-dasharray", dasharray ?? [1, 0]);
    },
    [],
  );

  const placeOriginMarker = useCallback((coord: [number, number]) => {
    const map = mapRef.current;
    if (!map) return;

    if (originMarkerRef.current) {
      originMarkerRef.current.remove();
      originMarkerRef.current = null;
    }

    const el = document.createElement("div");
    el.className = "origin-marker";
    const img = document.createElement("img");
    img.src = "/origin-marker.svg";
    img.alt = "Origin";
    img.width = 24;
    img.height = 36;
    img.style.pointerEvents = "none";
    el.appendChild(img);

    originMarkerRef.current = new maplibregl.Marker({ element: el })
      .setLngLat(coord)
      .addTo(map);
  }, []);

  const placeDestinationMarker = useCallback(
    (coord: [number, number], withinLimit: boolean) => {
      const map = mapRef.current;
      if (!map) return;

      if (destMarkerRef.current) {
        destMarkerRef.current.remove();
        destMarkerRef.current = null;
      }

      const el = document.createElement("div");
      el.className = "dest-marker";
      el.style.width = "16px";
      el.style.height = "16px";
      el.style.borderRadius = "50%";
      el.style.backgroundColor = withinLimit
        ? ROUTE_COLOR
        : ROUTE_OUTSIDE_COLOR;
      el.style.border = "2px solid white";
      el.style.boxShadow = "0 1px 3px rgba(0,0,0,0.3)";

      destMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat(coord)
        .addTo(map);
    },
    [],
  );

  const clearStopMarkers = useCallback(() => {
    if (stopPopupRef.current) {
      stopPopupRef.current.remove();
      stopPopupRef.current = null;
    }
    stopMarkersRef.current.forEach((m) => m.remove());
    stopMarkersRef.current = [];
  }, []);

  const updateStopMarkers = useCallback(
    (stops: StopSuggestion[]) => {
      clearStopMarkers();
      const map = mapRef.current;
      if (!map || stops.length === 0) return;

      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 14,
        anchor: "top",
        className: "stop-tooltip-popup",
      });
      stopPopupRef.current = popup;

      stops.forEach((stop) => {
        const el = document.createElement("div");
        el.className = "stop-marker";

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat(stop.coordinates)
          .addTo(map);

        el.addEventListener("mouseenter", () => {
          popup.setHTML(stop.name).setLngLat(stop.coordinates).addTo(map);
        });
        el.addEventListener("mouseleave", () => {
          popup.remove();
        });
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onStopClickRef.current(stop);
        });

        stopMarkersRef.current.push(marker);
      });
    },
    [clearStopMarkers],
  );

  const fetchAndSetStops = useCallback(
    async (
      originCoord: [number, number],
      destinationCoord: [number, number],
      category: PlaceCategory | null,
      currentMiles: number,
      currentMode: TravelMode,
    ): Promise<void> => {
      setStopLoading(true);
      setNearbyStops([]);
      try {
        const res = await suggestStop(
          originCoord[0], originCoord[1],
          destinationCoord[0], destinationCoord[1],
          category,
          currentMiles,
          currentMode,
        );
        const stops = res.stops ?? [];
        setNearbyStops(stops);
        updateStopMarkers(stops);
      } catch {
        console.error("suggest-stop failed");
        updateStopMarkers([]);
      } finally {
        setStopLoading(false);
      }
    },
    [updateStopMarkers],
  );

  const fitRouteBounds = useCallback((routeCoords: number[][]) => {
    const map = mapRef.current;
    if (!map || routeCoords.length === 0) return;
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const [lon, lat] of routeCoords) {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
    map.fitBounds(
      [[minLon, minLat], [maxLon, maxLat]],
      { padding: { top: 80, bottom: 80, left: 80, right: 380 }, duration: 800, maxZoom: 16 },
    );
  }, []);

  const applyShortestRouteToMap = useCallback(
    async (
      routeData: RouteResponse,
      originCoord: [number, number],
      destinationCoord: [number, number],
      category: PlaceCategory | null,
      currentMode: TravelMode,
    ): Promise<void> => {
      setDestination(destinationCoord);
      setShowingDetour(false);
      setSelectedStop(null);
      setDetourResult(null);
      setDetourLoading(false);
      removeAltRoute();

      placeDestinationMarker(destinationCoord, routeData.within_limit);
      renderRouteLine(
        routeData.route,
        routeData.within_limit ? ROUTE_COLOR : ROUTE_OUTSIDE_COLOR,
        "route",
        "route-line",
        0.9,
        4,
      );

      setClickPhase("route-shown");
      await fetchAndSetStops(originCoord, destinationCoord, category, effectiveMilesFor(currentMode), currentMode);
    },
    [
      fetchAndSetStops,
      placeDestinationMarker,
      removeAltRoute,
      renderRouteLine,
    ],
  );

  const applyDetourToMap = useCallback(
    (detour: RouteCheckResult, shortest: RouteCheckResult) => {
      renderRouteLine(
        shortest.route,
        shortest.within_limit ? ROUTE_COLOR : ROUTE_OUTSIDE_COLOR,
        "route-alt",
        "route-alt-line",
        0.3,
        3,
        [2, 2],
      );
      renderRouteLine(
        detour.route,
        detour.within_limit ? ROUTE_COLOR : ROUTE_OUTSIDE_COLOR,
        "route",
        "route-line",
        0.9,
        4,
      );
      setShowingDetour(true);
    },
    [renderRouteLine],
  );

  const removeRouteAndDestination = useCallback(() => {
    if (destMarkerRef.current) {
      destMarkerRef.current.remove();
      destMarkerRef.current = null;
    }
    clearStopMarkers();
    const map = mapRef.current;
    if (map) {
      if (map.getLayer("route-line")) map.removeLayer("route-line");
      if (map.getSource("route")) map.removeSource("route");
    }
    removeAltRoute();
  }, [clearStopMarkers, removeAltRoute]);

  const handleReset = useCallback(() => {
    detourStopKeyRef.current = null;
    if (originMarkerRef.current) {
      originMarkerRef.current.remove();
      originMarkerRef.current = null;
    }
    removeRouteAndDestination();
    setOrigin(null);
    setDestination(null);
    setNearbyStops([]);
    setSelectedStop(null);
    setStopLoading(false);
    setStopCategory(null);
    setDetourResult(null);
    setShowingDetour(false);
    setDetourLoading(false);
    clearResult();
    setClickPhase("set-origin");
    const map = mapRef.current;
    if (map && config) {
      const [lon, lat] = config.coordinates;
      map.flyTo({ center: [lon, lat], zoom: 13 });
    }
  }, [removeRouteAndDestination, clearResult, config]);

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
      if (originMarkerRef.current) {
        originMarkerRef.current.remove();
        originMarkerRef.current = null;
      }
      if (destMarkerRef.current) {
        destMarkerRef.current.remove();
        destMarkerRef.current = null;
      }
      clearStopMarkers();
      map.remove();
      mapRef.current = null;
    };
  }, [config, clearStopMarkers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const sourceId = "service-area";
    const lineLayerId = "service-area-line";

    const removeLayers = () => {
      if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };

    if (!polygon?.features?.length) {
      if (map.isStyleLoaded()) removeLayers();
      return;
    }

    const addLayers = () => {
      if (map.getSource(sourceId)) {
        (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(polygon);
        return;
      }
      map.addSource(sourceId, { type: "geojson", data: polygon });
      // Three concentric dashed rings — no fill, width grows with distance
      map.addLayer({
        id: lineLayerId,
        type: "line",
        source: sourceId,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#C45B28",
          "line-opacity": 0.7,
          "line-width": [
            "interpolate", ["linear"],
            ["get", "distance_miles"],
            0.5, 1.5,
            5.0, 3.0,
          ],
          "line-dasharray": [5, 4],
        },
      });
    };

    if (map.isStyleLoaded()) {
      addLayers();
    } else {
      const run = () => {
        map.off("load", run);
        addLayers();
      };
      map.on("load", run);
    }
  }, [polygon]);

  useEffect(() => {
    if (!config || !mapRef.current || restoreStartedRef.current) return;

    restoreStartedRef.current = true;
    const sharedState = initialShareStateRef.current;

    setStopCategory(sharedState.category);

    if (!sharedState.origin) {
      setRestoreReady(true);
      return;
    }

    const originCoord = sharedState.origin;
    placeOriginMarker(originCoord);
    setOrigin(originCoord);
    setClickPhase("set-destination");

    if (!sharedState.destination) {
      setRestoreReady(true);
      return;
    }

    let cancelled = false;
    const destinationCoord = sharedState.destination;

    void (async () => {
      try {
        const shortest = await checkRoute(
          destinationCoord[0],
          destinationCoord[1],
          effectiveMilesFor(mode),
          originCoord[0],
          originCoord[1],
          mode,
        );

        if (cancelled) return;

        await applyShortestRouteToMap(
          shortest,
          originCoord,
          destinationCoord,
          sharedState.category,
          mode,
        );
      } catch {
        // If restoration fails, leave the best partial state rather than forcing a reset.
      } finally {
        if (!cancelled) setRestoreReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    applyShortestRouteToMap,
    checkRoute,
    config,
    mode,
    placeOriginMarker,
  ]);

  useEffect(() => {
    if (resetRef) resetRef.current = handleReset;
  }, [resetRef, handleReset]);

  useEffect(() => {
    if (!restoreReady) return;

    replaceShareableRouteState({
      origin,
      destination,
      category: stopCategory,
      detour: showingDetour,
      mode,
    });
  }, [restoreReady, origin, destination, stopCategory, showingDetour, mode]);

  useEffect(() => {
    removeRouteAndDestination();
    clearResult();
    detourStopKeyRef.current = null;
    setNearbyStops([]);
    setSelectedStop(null);
    setStopLoading(false);
    setDestination(null);
    setDetourResult(null);
    setShowingDetour(false);
    setDetourLoading(false);
    setClickPhase((prev) => (prev === "route-shown" ? "set-destination" : prev));
  }, [removeRouteAndDestination, clearResult]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const isClickable =
      clickPhase === "set-origin" || clickPhase === "set-destination";
    const canvas = map.getCanvas();
    canvas.style.cursor = isClickable ? "crosshair" : "";

    const onMove = () => {
      if (isClickable) canvas.style.cursor = "crosshair";
    };
    map.on("mousemove", onMove);
    return () => {
      map.off("mousemove", onMove);
      canvas.style.cursor = "";
    };
  }, [clickPhase]);

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

        if (clickPhase === "set-origin" || clickPhase === "route-shown") {
          detourStopKeyRef.current = null;
          removeRouteAndDestination();
          clearResult();
          setNearbyStops([]);
          setSelectedStop(null);
          setStopLoading(false);
          setDestination(null);
          setDetourResult(null);
          setShowingDetour(false);
          setDetourLoading(false);

          placeOriginMarker([lng, lat]);
          setOrigin([lng, lat]);
          setClickPhase("set-destination");
          return;
        }

        if (clickPhase !== "set-destination" || !origin) return;

        isCheckingRef.current = true;
        detourStopKeyRef.current = null;

        checkRoute(lng, lat, effectiveMilesFor(mode), origin[0], origin[1], mode)
          .then((data) =>
            applyShortestRouteToMap(
              data,
              origin,
              [lng, lat],
              stopCategory,
              mode,
            ),
          )
          .catch(() => {
            // Stay in set-destination on error; user can retry or reset.
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
  }, [
    applyShortestRouteToMap,
    checkRoute,
    clearResult,
    clickPhase,
    config,
    isLoading,
    mode,
    origin,
    placeOriginMarker,
    removeRouteAndDestination,
    stopCategory,
  ]);

  const handleSelectStop = useCallback(
    async (stop: StopSuggestion) => {
      if (!origin || !destination || !result) return;

      const stopKey = stop.name;
      detourStopKeyRef.current = stopKey;
      setSelectedStop(stop);
      setShowingDetour(false);
      setDetourLoading(true);
      setDetourResult(null);
      removeAltRoute();
      // Restore shortest route line while computing detour
      renderRouteLine(
        result.route,
        result.within_limit ? ROUTE_COLOR : ROUTE_OUTSIDE_COLOR,
        "route",
        "route-line",
        0.9,
        4,
      );

      try {
        const [viaLon, viaLat] = stop.coordinates;
        const data = await getRoute(
          destination[0], destination[1], effectiveMilesFor(mode),
          origin[0], origin[1],
          viaLon, viaLat,
          mode,
        );
        if (detourStopKeyRef.current !== stopKey) return;
        const detour = toRouteCheckResult(data);
        setDetourResult(detour);
        applyDetourToMap(detour, result);
        fitRouteBounds(detour.route.geometry.coordinates);
      } catch {
        if (detourStopKeyRef.current === stopKey) setSelectedStop(null);
      } finally {
        if (detourStopKeyRef.current === stopKey) setDetourLoading(false);
      }
    },
    [applyDetourToMap, destination, fitRouteBounds, mode, origin, removeAltRoute, renderRouteLine, result],
  );

  // Keep ref current so map marker click handlers always call the latest version
  useEffect(() => {
    onStopClickRef.current = handleSelectStop;
  }, [handleSelectStop]);

  const handleBackToShortest = useCallback(() => {
    if (!result) return;
    setShowingDetour(false);
    setSelectedStop(null);
    renderRouteLine(
      result.route,
      result.within_limit ? ROUTE_COLOR : ROUTE_OUTSIDE_COLOR,
      "route",
      "route-line",
      0.9,
      4,
    );
    removeAltRoute();
  }, [removeAltRoute, renderRouteLine, result]);

  const handleCategoryChange = useCallback(
    (cat: PlaceCategory | null) => {
      setStopCategory(cat);
      setShowingDetour(false);
      setSelectedStop(null);
      removeAltRoute();
      detourStopKeyRef.current = null;
      setDetourResult(null);
      setDetourLoading(false);

      if (!result || !origin || !destination) return;

      void fetchAndSetStops(origin, destination, cat, effectiveMilesFor(mode), mode);
    },
    [destination, fetchAndSetStops, mode, origin, removeAltRoute, result],
  );

  const handleModeChange = useCallback(
    (newMode: TravelMode) => {
      onModeChange(newMode);

      if (!origin || !destination) return;

      // Re-route in place with the new mode
      isCheckingRef.current = true;
      detourStopKeyRef.current = null;
      setSelectedStop(null);
      setShowingDetour(false);
      setDetourResult(null);
      setDetourLoading(false);
      clearStopMarkers();
      setNearbyStops([]);
      removeAltRoute();

      checkRoute(destination[0], destination[1], effectiveMilesFor(newMode), origin[0], origin[1], newMode)
        .then((data) =>
          applyShortestRouteToMap(data, origin, destination, stopCategory, newMode),
        )
        .catch(() => {})
        .finally(() => {
          isCheckingRef.current = false;
        });
    },
    [
      onModeChange,
      origin,
      destination,
      stopCategory,
      clearStopMarkers,
      removeAltRoute,
      checkRoute,
      applyShortestRouteToMap,
    ],
  );

  if (!config) {
    return <div className="map-loading">Loading map…</div>;
  }

  const activeResult = showingDetour && detourResult ? detourResult : result;
  const showVerdictPanel = isLoading || result !== null || error !== null;
  const statusText =
    !showVerdictPanel && clickPhase === "set-origin"
      ? "Click map to set origin"
      : !showVerdictPanel && clickPhase === "set-destination"
        ? "Click map to set destination"
        : null;

  return (
    <div
      className={`map-wrapper ${isLoading ? "map-wrapper--loading" : ""}`}
    >
      <div ref={containerRef} className="map-container" />
      {statusText && <div className="map-status">{statusText}</div>}
      {origin && (
        <div className="ring-legend">
          {ringMilesFor(mode).map((mi, i) => (
            <div key={mi} className="ring-legend__row">
              <svg width="22" height="8" aria-hidden="true">
                <line
                  x1="0" y1="4" x2="22" y2="4"
                  stroke="#C45B28"
                  strokeOpacity="0.7"
                  strokeWidth={1.5 + i * 0.75}
                  strokeDasharray="4 3"
                />
              </svg>
              <span className="ring-legend__label">{mi} mi</span>
            </div>
          ))}
        </div>
      )}
      <aside className="app-sidebar">
        <ModeToggle mode={mode} onChange={handleModeChange} />
        {showVerdictPanel && (
          <VerdictPanel
            distance_miles={activeResult?.distance_miles ?? 0}
            duration_seconds={activeResult?.duration_seconds ?? 0}
            within_limit={activeResult?.within_limit ?? false}
            limit_miles={effectiveMilesFor(mode)}
            isLoading={isLoading}
            error={error}
            onReset={handleReset}
            nearbyStops={nearbyStops}
            selectedStop={selectedStop}
            stopLoading={stopLoading}
            onSelectStop={!showingDetour ? handleSelectStop : null}
            stopCategory={stopCategory}
            onCategoryChange={!showingDetour ? handleCategoryChange : null}
            detourLoading={detourLoading}
            showingDetour={showingDetour}
            shortestRoute={
              showingDetour && result
                ? {
                    distance_miles: result.distance_miles,
                    duration_seconds: result.duration_seconds,
                    within_limit: result.within_limit,
                  }
                : null
            }
            onBackToShortest={showingDetour ? handleBackToShortest : null}
          />
        )}
      </aside>
    </div>
  );
}
