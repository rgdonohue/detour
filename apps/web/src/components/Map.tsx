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
} from "../lib/api";
import { useServiceArea } from "../hooks/useServiceArea";
import { useRouteCheck, type RouteCheckResult } from "../hooks/useRouteCheck";
import { VerdictPanel } from "./VerdictPanel";
import type { PlaceCategory } from "../data/places";
import {
  parseShareableRouteState,
  replaceShareableRouteState,
} from "../lib/urlState";

const CLICK_DEBOUNCE_MS = 300;
const TONER_LITE_URL =
  "https://tiles.stadiamaps.com/tiles/stamen_toner_lite/{z}/{x}/{y}.png";

const ROUTE_WITHIN_COLOR = "#2D7D46";
const ROUTE_OUTSIDE_COLOR = "#B8432F";
const MILE_PRESETS = [1, 3, 5] as const;

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
  miles: number;
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

export function Map({ miles }: MapProps) {
  const initialShareStateRef = useRef(parseShareableRouteState(MILE_PRESETS));
  const restoreStartedRef = useRef(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const originMarkerRef = useRef<maplibregl.Marker | null>(null);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);
  const stopMarkerRef = useRef<maplibregl.Marker | null>(null);
  const isCheckingRef = useRef(false);
  const detourStopKeyRef = useRef<string | null>(null);

  const [config, setConfig] = useState<Config | null>(null);
  const [clickPhase, setClickPhase] = useState<ClickPhase>("set-origin");
  const [origin, setOrigin] = useState<[number, number] | null>(null);
  const [destination, setDestination] = useState<[number, number] | null>(null);
  const [nearbyStop, setNearbyStop] = useState<StopSuggestion | null>(null);
  const [stopLoading, setStopLoading] = useState(false);
  const [stopCategory, setStopCategory] = useState<PlaceCategory | null>(null);
  const [detourResult, setDetourResult] = useState<RouteCheckResult | null>(null);
  const [showingDetour, setShowingDetour] = useState(false);
  const [detourLoading, setDetourLoading] = useState(false);
  const [restoreReady, setRestoreReady] = useState(false);

  const { polygon } = useServiceArea(miles, origin?.[0], origin?.[1]);
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
        ? ROUTE_WITHIN_COLOR
        : ROUTE_OUTSIDE_COLOR;
      el.style.border = "2px solid white";
      el.style.boxShadow = "0 1px 3px rgba(0,0,0,0.3)";

      destMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat(coord)
        .addTo(map);
    },
    [],
  );

  const updateNearbyStopMarker = useCallback((stop: StopSuggestion | null) => {
    if (stopMarkerRef.current) {
      stopMarkerRef.current.remove();
      stopMarkerRef.current = null;
    }

    const map = mapRef.current;
    if (!map || !stop) return;

    const stopEl = document.createElement("div");
    stopEl.className = "stop-marker";
    stopMarkerRef.current = new maplibregl.Marker({ element: stopEl })
      .setLngLat(stop.coordinates)
      .addTo(map);
  }, []);

  const fetchAndSetStop = useCallback(
    async (
      originCoord: [number, number],
      destinationCoord: [number, number],
      category: PlaceCategory | null,
      currentMiles: number,
    ): Promise<StopSuggestion | null> => {
      setStopLoading(true);
      setNearbyStop(null);
      try {
        const res = await suggestStop(
          originCoord[0], originCoord[1],
          destinationCoord[0], destinationCoord[1],
          category,
          currentMiles,
        );
        const stop = res.stop ?? null;
        setNearbyStop(stop);
        updateNearbyStopMarker(stop);
        return stop;
      } catch {
        console.error("suggest-stop failed");
        updateNearbyStopMarker(null);
        return null;
      } finally {
        setStopLoading(false);
      }
    },
    [updateNearbyStopMarker],
  );

  const precomputeDetour = useCallback(
    async (
      stop: StopSuggestion | null,
      originCoord: [number, number],
      destinationCoord: [number, number],
      currentMiles: number,
    ): Promise<RouteCheckResult | null> => {
      detourStopKeyRef.current = stop ? stop.name : null;
      setDetourResult(null);

      if (!stop) {
        setDetourLoading(false);
        return null;
      }

      const stopKey = stop.name;
      const [viaLon, viaLat] = stop.coordinates;
      setDetourLoading(true);

      try {
        const detourData = await getRoute(
          destinationCoord[0],
          destinationCoord[1],
          currentMiles,
          originCoord[0],
          originCoord[1],
          viaLon,
          viaLat,
        );

        if (detourStopKeyRef.current !== stopKey) return null;

        const nextDetour = toRouteCheckResult(detourData);
        setDetourResult(nextDetour);
        return nextDetour;
      } catch {
        return null;
      } finally {
        if (detourStopKeyRef.current === stopKey) {
          setDetourLoading(false);
        }
      }
    },
    [],
  );

  const applyShortestRouteToMap = useCallback(
    async (
      routeData: RouteResponse,
      originCoord: [number, number],
      destinationCoord: [number, number],
      category: PlaceCategory | null,
      options?: { precomputeDetour?: boolean },
    ): Promise<{ stop: StopSuggestion | null; detour: RouteCheckResult | null }> => {
      setDestination(destinationCoord);
      setShowingDetour(false);
      removeAltRoute();

      placeDestinationMarker(destinationCoord, routeData.within_limit);
      renderRouteLine(
        routeData.route,
        routeData.within_limit ? ROUTE_WITHIN_COLOR : ROUTE_OUTSIDE_COLOR,
        "route",
        "route-line",
        0.9,
        4,
      );

      setClickPhase("route-shown");
      const stop = await fetchAndSetStop(originCoord, destinationCoord, category, miles);

      if (options?.precomputeDetour === false) {
        setDetourResult(null);
        setDetourLoading(false);
        return { stop, detour: null };
      }

      const detour = await precomputeDetour(stop, originCoord, destinationCoord, miles);
      return { stop, detour };
    },
    [
      miles,
      fetchAndSetStop,
      placeDestinationMarker,
      precomputeDetour,
      removeAltRoute,
      renderRouteLine,
    ],
  );

  const applyDetourToMap = useCallback(
    (detour: RouteCheckResult, shortest: RouteCheckResult) => {
      renderRouteLine(
        shortest.route,
        shortest.within_limit ? ROUTE_WITHIN_COLOR : ROUTE_OUTSIDE_COLOR,
        "route-alt",
        "route-alt-line",
        0.3,
        3,
        [2, 2],
      );
      renderRouteLine(
        detour.route,
        detour.within_limit ? ROUTE_WITHIN_COLOR : ROUTE_OUTSIDE_COLOR,
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
    if (stopMarkerRef.current) {
      stopMarkerRef.current.remove();
      stopMarkerRef.current = null;
    }
    const map = mapRef.current;
    if (map) {
      if (map.getLayer("route-line")) map.removeLayer("route-line");
      if (map.getSource("route")) map.removeSource("route");
    }
    removeAltRoute();
  }, [removeAltRoute]);

  const handleReset = useCallback(() => {
    detourStopKeyRef.current = null;
    if (originMarkerRef.current) {
      originMarkerRef.current.remove();
      originMarkerRef.current = null;
    }
    removeRouteAndDestination();
    setOrigin(null);
    setDestination(null);
    setNearbyStop(null);
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
      if (stopMarkerRef.current) {
        stopMarkerRef.current.remove();
        stopMarkerRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
  }, [config]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const sourceId = "service-area";
    const fillLayerId = "service-area-fill";
    const lineLayerId = "service-area-line";

    const removeLayers = () => {
      if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId);
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
      map.addLayer({
        id: fillLayerId,
        type: "fill",
        source: sourceId,
        paint: { "fill-color": "#C45B28", "fill-opacity": 0.12 },
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
          miles,
          originCoord[0],
          originCoord[1],
        );

        if (cancelled) return;

        const { detour } = await applyShortestRouteToMap(
          shortest,
          originCoord,
          destinationCoord,
          sharedState.category,
        );

        if (cancelled || !sharedState.detour || !detour) return;

        applyDetourToMap(detour, toRouteCheckResult(shortest));
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
    applyDetourToMap,
    applyShortestRouteToMap,
    checkRoute,
    config,
    miles,
    placeOriginMarker,
  ]);

  useEffect(() => {
    if (!restoreReady) return;

    replaceShareableRouteState({
      origin,
      destination,
      miles,
      category: stopCategory,
      detour: showingDetour,
    });
  }, [restoreReady, origin, destination, miles, stopCategory, showingDetour]);

  useEffect(() => {
    removeRouteAndDestination();
    clearResult();
    detourStopKeyRef.current = null;
    setNearbyStop(null);
    setStopLoading(false);
    setDestination(null);
    setDetourResult(null);
    setShowingDetour(false);
    setDetourLoading(false);
    setClickPhase((prev) => (prev === "route-shown" ? "set-destination" : prev));
  }, [miles, removeRouteAndDestination, clearResult]);

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
          setNearbyStop(null);
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

        checkRoute(lng, lat, miles, origin[0], origin[1])
          .then((data) =>
            applyShortestRouteToMap(
              data,
              origin,
              [lng, lat],
              stopCategory,
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
    miles,
    origin,
    placeOriginMarker,
    removeRouteAndDestination,
    stopCategory,
  ]);

  const handleRouteViaStop = useCallback(async () => {
    if (!origin || !destination || !result || !nearbyStop || detourLoading) return;

    if (detourResult) {
      applyDetourToMap(detourResult, result);
      return;
    }

    setDetourLoading(true);
    try {
      const [viaLon, viaLat] = nearbyStop.coordinates;
      const data = await getRoute(
        destination[0],
        destination[1],
        miles,
        origin[0],
        origin[1],
        viaLon,
        viaLat,
      );
      const detour = toRouteCheckResult(data);
      setDetourResult(detour);
      applyDetourToMap(detour, result);
    } catch {
      // Detour failed; stay on shortest route.
    } finally {
      setDetourLoading(false);
    }
  }, [
    applyDetourToMap,
    destination,
    detourLoading,
    detourResult,
    miles,
    nearbyStop,
    origin,
    result,
  ]);

  const handleBackToShortest = useCallback(() => {
    if (!result) return;
    setShowingDetour(false);
    renderRouteLine(
      result.route,
      result.within_limit ? ROUTE_WITHIN_COLOR : ROUTE_OUTSIDE_COLOR,
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
      removeAltRoute();
      detourStopKeyRef.current = null;
      setDetourResult(null);

      if (!result || !origin || !destination) return;

      void (async () => {
        const stop = await fetchAndSetStop(origin, destination, cat, miles);
        if (!stop) {
          setDetourLoading(false);
          return;
        }
        void precomputeDetour(stop, origin, destination, miles);
      })();
    },
    [destination, fetchAndSetStop, miles, origin, precomputeDetour, removeAltRoute, result],
  );

  if (!config) {
    return <div className="map-loading">Loading map…</div>;
  }

  const activeResult = showingDetour && detourResult ? detourResult : result;
  const showVerdictPanel = isLoading || result !== null || error !== null;
  const detourPreview =
    !showingDetour && nearbyStop && detourResult && result
      ? {
          extra_miles: detourResult.distance_miles - result.distance_miles,
          within_limit: detourResult.within_limit,
        }
      : null;
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
      {showVerdictPanel && (
        <VerdictPanel
          distance_miles={activeResult?.distance_miles ?? 0}
          duration_seconds={activeResult?.duration_seconds ?? 0}
          within_limit={activeResult?.within_limit ?? false}
          limit_miles={miles}
          isLoading={isLoading}
          error={error}
          onReset={handleReset}
          nearbyStop={nearbyStop}
          stopLoading={stopLoading}
          onRouteViaStop={!showingDetour && nearbyStop ? handleRouteViaStop : null}
          detourPreview={detourPreview}
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
    </div>
  );
}
