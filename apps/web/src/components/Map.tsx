import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getConfig,
  getRoute,
  saveTour,
  suggestStop,
  type Config,
  type RouteResponse,
  type StopSuggestion,
  type TravelMode,
} from "../lib/api";
import { buildTourFromState } from "../lib/buildTour";
import { optimizeStopOrder } from "../lib/optimizeStops";
import { useServiceArea } from "../hooks/useServiceArea";
import { useRouteCheck, type RouteCheckResult } from "../hooks/useRouteCheck";
import { VerdictPanel } from "./VerdictPanel";
import { ModeToggle } from "./ModeToggle";
import { CATEGORY_COLORS, type PlaceCategory } from "../data/places";
import {
  parseShareableRouteState,
  replaceShareableRouteState,
} from "../lib/urlState";

const CLICK_DEBOUNCE_MS = 300;
const TONER_LITE_URL =
  "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";

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
  modeChangeRef?: { current: (mode: TravelMode) => void };
  mode: TravelMode;
  onModeChange: (mode: TravelMode) => void;
}

/** Minimum distance in miles from a point to the nearest route vertex. */
function minRouteDistanceMiles(coord: [number, number], routeCoords: number[][]): number {
  let bestDist = Infinity;
  for (let i = 0; i < routeCoords.length; i++) {
    const dLon = (coord[0] - routeCoords[i][0]) * Math.cos(((coord[1] + routeCoords[i][1]) / 2) * Math.PI / 180);
    const dLat = coord[1] - routeCoords[i][1];
    const d = Math.sqrt(dLon * dLon + dLat * dLat);
    if (d < bestDist) bestDist = d;
  }
  // Convert degrees to miles (1 degree latitude ≈ 69.0 miles)
  return bestDist * 69.0;
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

export function Map({ resetRef, modeChangeRef, mode, onModeChange }: MapProps) {
  const navigate = useNavigate();
  const initialShareStateRef = useRef(parseShareableRouteState());
  const restoreStartedRef = useRef(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const originMarkerRef = useRef<maplibregl.Marker | null>(null);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);
  const stopMarkersRef = useRef<{ stop: StopSuggestion; el: HTMLElement; marker: maplibregl.Marker }[]>([]);
  const stopPopupRef = useRef<maplibregl.Popup | null>(null);
  const popupFadeStartRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupFadeRemoveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCheckingRef = useRef(false);
  const detourRequestRef = useRef<number>(0);
  const detourAbortControllerRef = useRef<AbortController | null>(null);
  const stopSuggestControllerRef = useRef<AbortController | null>(null);
  const onStopClickRef = useRef<(stop: StopSuggestion) => void>(() => {});

  const [config, setConfig] = useState<Config | null>(null);
  const [clickPhase, setClickPhase] = useState<ClickPhase>("set-origin");
  const [origin, setOrigin] = useState<[number, number] | null>(null);
  const [destination, setDestination] = useState<[number, number] | null>(null);
  const [nearbyStops, setNearbyStops] = useState<StopSuggestion[]>([]);
  const [selectedStops, setSelectedStops] = useState<StopSuggestion[]>([]);
  const [stopLoading, setStopLoading] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [activeCategories, setActiveCategories] = useState<Set<PlaceCategory>>(
    () => new Set<PlaceCategory>(["history", "art", "scenic", "culture", "civic"])
  );
  const [detourResult, setDetourResult] = useState<RouteCheckResult | null>(null);
  const [showingDetour, setShowingDetour] = useState(false);
  const [detourLoading, setDetourLoading] = useState(false);
  const [restoreReady, setRestoreReady] = useState(false);
  const [showRings, setShowRings] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [showAllStops, setShowAllStops] = useState(false);
  const [savingTour, setSavingTour] = useState(false);
  const [saveTourError, setSaveTourError] = useState<string | null>(null);
  const showRingsRef = useRef(false);
  showRingsRef.current = showRings;
  const showAllStopsRef = useRef(false);
  showAllStopsRef.current = showAllStops;

  const { polygon } = useServiceArea(origin?.[0], origin?.[1], mode);
  const { checkRoute, clearResult, result, isLoading, error } = useRouteCheck();
  const resultRef = useRef(result);
  resultRef.current = result;

  // Refs for dragend handlers — they need fresh values without making
  // placeOriginMarker / placeDestinationMarker depend on changing state,
  // which would defeat their useCallback([]) memoization and rebuild
  // markers on every render.
  const originRef = useRef<[number, number] | null>(null);
  const destinationRef = useRef<[number, number] | null>(null);
  const modeRef = useRef<TravelMode>(mode);
  const checkRouteRef = useRef<typeof checkRoute | null>(null);
  const applyRouteRef = useRef<
    | ((
        routeData: RouteResponse,
        originCoord: [number, number],
        destinationCoord: [number, number],
        currentMode: TravelMode,
      ) => Promise<StopSuggestion[]>)
    | null
  >(null);
  originRef.current = origin;
  destinationRef.current = destination;
  modeRef.current = mode;
  checkRouteRef.current = checkRoute;

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

    const marker = new maplibregl.Marker({ element: el, draggable: true })
      .setLngLat(coord)
      .addTo(map);
    originMarkerRef.current = marker;

    marker.on("dragend", () => {
      const prevOrigin = originRef.current;
      const { lng, lat } = marker.getLngLat();
      const newOrigin: [number, number] = [lng, lat];
      setOrigin(newOrigin);

      const dest = destinationRef.current;
      if (!dest) return;

      const check = checkRouteRef.current;
      const apply = applyRouteRef.current;
      if (!check || !apply) return;

      check(
        dest[0], dest[1],
        effectiveMilesFor(modeRef.current),
        lng, lat,
        modeRef.current,
      )
        .then((data) => apply(data, newOrigin, dest, modeRef.current))
        .catch((err) => {
          if (err instanceof Error && err.name === "AbortError") return;
          if (prevOrigin) {
            marker.setLngLat(prevOrigin);
            setOrigin(prevOrigin);
          }
        });
    });
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

      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat(coord)
        .addTo(map);
      destMarkerRef.current = marker;

      marker.on("dragend", () => {
        const prevDest = destinationRef.current;
        const { lng, lat } = marker.getLngLat();
        const orig = originRef.current;
        if (!orig) return;

        const check = checkRouteRef.current;
        const apply = applyRouteRef.current;
        if (!check || !apply) return;

        check(
          lng, lat,
          effectiveMilesFor(modeRef.current),
          orig[0], orig[1],
          modeRef.current,
        )
          .then((data) => apply(data, orig, [lng, lat], modeRef.current))
          .catch((err) => {
            if (err instanceof Error && err.name === "AbortError") return;
            if (prevDest) marker.setLngLat(prevDest);
          });
      });
    },
    [],
  );

  const clearPopupFade = useCallback(() => {
    if (popupFadeStartRef.current) {
      clearTimeout(popupFadeStartRef.current);
      popupFadeStartRef.current = null;
    }
    if (popupFadeRemoveRef.current) {
      clearTimeout(popupFadeRemoveRef.current);
      popupFadeRemoveRef.current = null;
    }
    stopPopupRef.current
      ?.getElement()
      ?.classList.remove("stop-tooltip-popup--fade-out");
  }, []);

  const clearStopMarkers = useCallback(() => {
    clearPopupFade();
    if (stopPopupRef.current) {
      stopPopupRef.current.remove();
      stopPopupRef.current = null;
    }
    stopMarkersRef.current.forEach(({ marker }) => marker.remove());
    stopMarkersRef.current = [];
  }, [clearPopupFade]);

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

      // Rank stops by distance to route; top N are default-visible
      const routeCoords = resultRef.current?.route?.geometry?.coordinates;
      const DEFAULT_VISIBLE = 10;
      const defaultVisibleNames = new Set(
        stops
          .map((stop) => ({
            stop,
            dist: routeCoords ? minRouteDistanceMiles(stop.coordinates, routeCoords) : 0,
          }))
          .sort((a, b) => a.dist - b.dist)
          .slice(0, DEFAULT_VISIBLE)
          .map((r) => r.stop.name)
      );

      stops.forEach((stop) => {
        const el = document.createElement("div");
        el.className = "stop-marker";
        const color = CATEGORY_COLORS[stop.category as PlaceCategory];
        if (color) el.style.setProperty("--stop-marker-color", color);

        el.dataset.defaultVisible = defaultVisibleNames.has(stop.name) ? "true" : "false";

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat(stop.coordinates);

        if (el.dataset.defaultVisible === "true" || showAllStopsRef.current) {
          marker.addTo(map);
        }

        el.addEventListener("mouseenter", () => {
          clearPopupFade();
          popup.setHTML(stop.name).setLngLat(stop.coordinates).addTo(map);
        });
        el.addEventListener("mouseleave", () => {
          clearPopupFade();
          popup.remove();
        });
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onStopClickRef.current(stop);
        });

        stopMarkersRef.current.push({ stop, el, marker });
      });
    },
    [clearStopMarkers, clearPopupFade],
  );

  const fetchAndSetStops = useCallback(
    async (
      originCoord: [number, number],
      destinationCoord: [number, number],
      category: PlaceCategory | null,
      currentMiles: number,
      currentMode: TravelMode,
      routeCoordinates: number[][] | null = null,
      persistedStops: StopSuggestion[] = [],
    ): Promise<StopSuggestion[]> => {
      stopSuggestControllerRef.current?.abort();
      stopSuggestControllerRef.current = new AbortController();
      const { signal } = stopSuggestControllerRef.current;

      setStopLoading(true);
      setNearbyStops([]);
      setStopError(null);
      try {
        const res = await suggestStop(
          originCoord[0], originCoord[1],
          destinationCoord[0], destinationCoord[1],
          category,
          currentMiles,
          currentMode,
          signal,
          routeCoordinates ?? undefined,
        );
        if (signal.aborted) return [];
        const stops = res.stops ?? [];
        setNearbyStops(stops);
        // Merge persisted selections not in current results so their markers stay on the map
        const names = new Set(stops.map((s) => s.name));
        const extra = persistedStops.filter((s) => !names.has(s.name));
        updateStopMarkers([...stops, ...extra]);
        return stops;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return [];
        setStopError("Couldn't load stops nearby.");
        updateStopMarkers([...persistedStops]);
        return [];
      } finally {
        if (!signal.aborted) setStopLoading(false);
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
      { padding: 80, duration: 800, maxZoom: 16 },
    );
  }, []);

  const applyShortestRouteToMap = useCallback(
    async (
      routeData: RouteResponse,
      originCoord: [number, number],
      destinationCoord: [number, number],
      currentMode: TravelMode,
    ): Promise<StopSuggestion[]> => {
      setDestination(destinationCoord);
      setShowingDetour(false);
      setSelectedStops([]);
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
      fitRouteBounds(routeData.route.geometry.coordinates);

      setClickPhase("route-shown");
      return fetchAndSetStops(
        originCoord,
        destinationCoord,
        null,
        effectiveMilesFor(currentMode),
        currentMode,
        routeData.route.geometry.coordinates,
      );
    },
    [
      fetchAndSetStops,
      fitRouteBounds,
      placeDestinationMarker,
      removeAltRoute,
      renderRouteLine,
    ],
  );
  applyRouteRef.current = applyShortestRouteToMap;

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
    detourRequestRef.current += 1;
    detourAbortControllerRef.current?.abort();
    stopSuggestControllerRef.current?.abort();
    if (originMarkerRef.current) {
      originMarkerRef.current.remove();
      originMarkerRef.current = null;
    }
    removeRouteAndDestination();
    setOrigin(null);
    setDestination(null);
    setNearbyStops([]);
    setSelectedStops([]);
    setStopLoading(false);
    setStopError(null);
    setActiveCategories(new Set(["history", "art", "scenic", "culture", "civic"]));
    setDetourResult(null);
    setShowingDetour(false);
    setDetourLoading(false);
    setShowRings(false);
    setShowAllStops(false);
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
            attribution:
              '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &middot; Routing by <a href="https://openrouteservice.org/">OpenRouteService</a>',
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

    // Keep the camera center in the visible (non-sidebar) area at all times.
    // This means fitBounds, flyTo, and free panning all operate in the same
    // coordinate space — the user can pan to visually centre anything without
    // it sliding under the sidebar panel.
    if (window.innerWidth > 768) {
      map.setPadding({ top: 0, bottom: 0, left: 0, right: 300 });
    }

    mapRef.current = map;

    map.once("idle", () => setMapReady(true));

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
        layout: { "line-join": "round", "line-cap": "round", "visibility": showRingsRef.current ? "visible" : "none" },
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
    const map = mapRef.current;
    if (!map) return;
    const lineLayerId = "service-area-line";
    const apply = () => {
      if (map.getLayer(lineLayerId)) {
        map.setLayoutProperty(lineLayerId, "visibility", showRings ? "visible" : "none");
      }
    };
    if (map.isStyleLoaded()) {
      apply();
    } else {
      map.once("load", apply);
    }
  }, [showRings]);

  useEffect(() => {
    if (!config || !mapRef.current || restoreStartedRef.current) return;

    restoreStartedRef.current = true;
    const sharedState = initialShareStateRef.current;

    if (sharedState.category) {
      setActiveCategories(new Set(sharedState.category));
    }

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

        const fetchedStops = await applyShortestRouteToMap(
          shortest,
          originCoord,
          destinationCoord,
          mode,
        );

        if (cancelled || sharedState.via.length === 0 || fetchedStops.length === 0) return;

        // Match via coordinates to fetched stops (threshold ~10 m)
        const THRESHOLD = 0.0001;
        const toRestore = sharedState.via
          .map((v) =>
            fetchedStops.find(
              (s) =>
                Math.abs(s.coordinates[0] - v[0]) < THRESHOLD &&
                Math.abs(s.coordinates[1] - v[1]) < THRESHOLD,
            ),
          )
          .filter((s): s is StopSuggestion => s !== undefined);

        if (toRestore.length === 0) return;

        const sorted = optimizeStopOrder(originCoord, destinationCoord, toRestore);
        setSelectedStops(sorted);

        detourRequestRef.current += 1;
        const reqId = detourRequestRef.current;
        detourAbortControllerRef.current?.abort();
        detourAbortControllerRef.current = new AbortController();
        const detourSignal = detourAbortControllerRef.current.signal;
        setDetourLoading(true);

        try {
          const viaData = await getRoute(
            destinationCoord[0], destinationCoord[1], effectiveMilesFor(mode),
            originCoord[0], originCoord[1],
            sorted.map((s) => s.coordinates),
            mode,
            detourSignal,
          );
          if (cancelled || detourRequestRef.current !== reqId) return;
          const detour = toRouteCheckResult(viaData);
          setDetourResult(detour);
          applyDetourToMap(detour, toRouteCheckResult(shortest));
          fitRouteBounds(detour.route.geometry.coordinates);
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return;
          // detour restoration failed — shortest route stays shown
        } finally {
          if (!cancelled && detourRequestRef.current === reqId) setDetourLoading(false);
        }
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
    applyDetourToMap,
    checkRoute,
    config,
    fitRouteBounds,
    mode,
    placeOriginMarker,
  ]);

  useEffect(() => {
    if (resetRef) resetRef.current = handleReset;
  }, [resetRef, handleReset]);


  useEffect(() => {
    if (!restoreReady) return;

    const allCats: PlaceCategory[] = ["history", "art", "scenic", "culture", "civic"];
    const catArray = activeCategories.size === allCats.length ? null : [...activeCategories];
    replaceShareableRouteState({
      origin,
      destination,
      category: catArray,
      via: selectedStops.map((s) => s.coordinates),
      mode,
    });
  }, [restoreReady, origin, destination, activeCategories, selectedStops, mode]);

  useEffect(() => {
    removeRouteAndDestination();
    clearResult();
    detourRequestRef.current += 1;
    setNearbyStops([]);
    setSelectedStops([]);
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

        if (clickPhase === "set-origin") {
          detourRequestRef.current += 1;
          removeRouteAndDestination();
          clearResult();
          setNearbyStops([]);
          setSelectedStops([]);
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
        detourRequestRef.current += 1;

        checkRoute(lng, lat, effectiveMilesFor(mode), origin[0], origin[1], mode)
          .then((data) =>
            applyShortestRouteToMap(data, origin, [lng, lat], mode),
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
  ]);

  const handleSelectStop = useCallback(
    async (stop: StopSuggestion) => {
      if (!origin || !destination || !result) return;

      const isSelected = selectedStops.some((s) => s.name === stop.name);
      const nextStops = isSelected
        ? selectedStops.filter((s) => s.name !== stop.name)
        : [...selectedStops, stop];
      const newSelected = optimizeStopOrder(origin, destination, nextStops);

      setSelectedStops(newSelected);

      if (newSelected.length === 0) {
        setShowingDetour(false);
        setDetourResult(null);
        setDetourLoading(false);
        renderRouteLine(result.route, result.within_limit ? ROUTE_COLOR : ROUTE_OUTSIDE_COLOR, "route", "route-line", 0.9, 4);
        removeAltRoute();
        return;
      }

      detourRequestRef.current += 1;
      const reqId = detourRequestRef.current;
      detourAbortControllerRef.current?.abort();
      detourAbortControllerRef.current = new AbortController();
      const detourSignal = detourAbortControllerRef.current.signal;
      setShowingDetour(false);
      setDetourLoading(true);
      setDetourResult(null);
      removeAltRoute();
      renderRouteLine(result.route, result.within_limit ? ROUTE_COLOR : ROUTE_OUTSIDE_COLOR, "route", "route-line", 0.9, 4);

      try {
        const data = await getRoute(
          destination[0], destination[1], effectiveMilesFor(mode),
          origin[0], origin[1],
          newSelected.map((s) => s.coordinates),
          mode,
          detourSignal,
        );
        if (detourRequestRef.current !== reqId) return;
        const detour = toRouteCheckResult(data);
        setDetourResult(detour);
        applyDetourToMap(detour, result);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        // Keep selection visible; loading clears below
      } finally {
        if (detourRequestRef.current === reqId) setDetourLoading(false);
      }
    },
    [applyDetourToMap, destination, mode, origin, removeAltRoute, renderRouteLine, result, selectedStops],
  );

  // Keep ref current so map marker click handlers always call the latest version
  useEffect(() => {
    onStopClickRef.current = handleSelectStop;
  }, [handleSelectStop]);

  const handleFocusStop = useCallback(
    (stop: StopSuggestion) => {
      const map = mapRef.current;
      const popup = stopPopupRef.current;
      if (!map) return;
      map.flyTo({ center: stop.coordinates, zoom: 16, duration: 700 });
      if (!popup) return;
      clearPopupFade();
      popup.setHTML(stop.name).setLngLat(stop.coordinates).addTo(map);
      popupFadeStartRef.current = setTimeout(() => {
        const el = popup.getElement();
        el?.classList.add("stop-tooltip-popup--fade-out");
        popupFadeRemoveRef.current = setTimeout(() => {
          popup.remove();
          el?.classList.remove("stop-tooltip-popup--fade-out");
        }, 320);
      }, 4000);
    },
    [clearPopupFade],
  );

  // Add/remove markers based on default-visible rank, showAllStops toggle, and active categories
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    stopMarkersRef.current.forEach(({ stop, el, marker }) => {
      const inCategory = activeCategories.has(stop.category as PlaceCategory);
      const inDefaultSet = el.dataset.defaultVisible === "true";
      const shouldShow = inCategory && (inDefaultSet || showAllStops);
      const isOnMap = el.parentNode !== null;
      const isSelected = el.classList.contains("stop-marker--selected");
      if (isSelected) return;
      if (shouldShow && !isOnMap) {
        el.style.opacity = "0";
        marker.addTo(map);
        requestAnimationFrame(() => { el.style.opacity = ""; });
      } else if (!shouldShow && isOnMap) {
        marker.remove();
      }
    });
  }, [showAllStops, nearbyStops, activeCategories]);

  // Sync selected-stop affordance, order badges, and dim unselected markers
  useEffect(() => {
    const map = mapRef.current;
    const hasSelection = selectedStops.length > 0;
    stopMarkersRef.current.forEach(({ stop, el, marker }) => {
      const idx = selectedStops.findIndex((s) => s.name === stop.name);
      const isSelected = idx >= 0;
      el.classList.toggle("stop-marker--selected", isSelected);
      el.dataset.order = isSelected ? String(idx + 1) : "";

      if (isSelected) {
        if (map && el.parentNode === null) {
          el.style.opacity = "0";
          marker.addTo(map);
          requestAnimationFrame(() => { el.style.opacity = ""; });
        }
        el.style.opacity = "";
      } else if (hasSelection) {
        el.style.opacity = "0.45";
      } else {
        el.style.opacity = "";
      }
    });
  }, [selectedStops]);

  const handleBackToShortest = useCallback(() => {
    if (!result) return;
    setShowingDetour(false);
    setSelectedStops([]);
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

  const handleToggleCategory = useCallback((cat: PlaceCategory) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const handleToggleAllCategories = useCallback(() => {
    setActiveCategories((prev) => {
      const allCats: PlaceCategory[] = ["history", "art", "scenic", "culture", "civic"];
      return prev.size === allCats.length ? new Set<PlaceCategory>() : new Set(allCats);
    });
  }, []);

  const handleModeChange = useCallback(
    (newMode: TravelMode) => {
      onModeChange(newMode);

      if (!origin || !destination) return;

      const stopsToRestore = selectedStops;

      // Re-route in place with the new mode, preserving selected stops
      isCheckingRef.current = true;
      detourRequestRef.current += 1;
      setShowingDetour(false);
      setDetourResult(null);
      setDetourLoading(false);
      clearStopMarkers();
      setNearbyStops([]);
      removeAltRoute();

      checkRoute(destination[0], destination[1], effectiveMilesFor(newMode), origin[0], origin[1], newMode)
        .then(async (data) => {
          // Apply direct route to map
          placeDestinationMarker(destination, data.within_limit);
          renderRouteLine(
            data.route, data.within_limit ? ROUTE_COLOR : ROUTE_OUTSIDE_COLOR,
            "route", "route-line", 0.9, 4,
          );
          fitRouteBounds(data.route.geometry.coordinates);
          setClickPhase("route-shown");
          await fetchAndSetStops(
            origin,
            destination,
            null,
            effectiveMilesFor(newMode),
            newMode,
            data.route.geometry.coordinates,
            stopsToRestore,
          );

          if (stopsToRestore.length === 0) {
            setSelectedStops([]);
            return;
          }

          // Recompute multi-stop route for the new mode; stop order is mode-independent.
          const sorted = optimizeStopOrder(origin, destination, stopsToRestore);
          setSelectedStops(sorted);
          detourRequestRef.current += 1;
          const reqId = detourRequestRef.current;
          detourAbortControllerRef.current?.abort();
          detourAbortControllerRef.current = new AbortController();
          const detourSignal = detourAbortControllerRef.current.signal;
          setDetourLoading(true);

          try {
            const viaData = await getRoute(
              destination[0], destination[1], effectiveMilesFor(newMode),
              origin[0], origin[1],
              sorted.map((s) => s.coordinates),
              newMode,
              detourSignal,
            );
            if (detourRequestRef.current !== reqId) return;
            const directResult = toRouteCheckResult(data);
            const detour = toRouteCheckResult(viaData);
            setDetourResult(detour);
            applyDetourToMap(detour, directResult);
          } catch (err) {
            if (err instanceof Error && err.name === "AbortError") return;
            if (detourRequestRef.current === reqId) setSelectedStops([]);
          } finally {
            if (detourRequestRef.current === reqId) setDetourLoading(false);
          }
        })
        .catch(() => {})
        .finally(() => {
          isCheckingRef.current = false;
        });
    },
    [
      onModeChange,
      origin,
      destination,
      selectedStops,
      clearStopMarkers,
      removeAltRoute,
      checkRoute,
      placeDestinationMarker,
      renderRouteLine,
      fitRouteBounds,
      fetchAndSetStops,
      applyDetourToMap,
    ],
  );

  useEffect(() => {
    if (modeChangeRef) modeChangeRef.current = handleModeChange;
  }, [modeChangeRef, handleModeChange]);

  const handlePlayTour = useCallback(async () => {
    if (savingTour) return;
    if (!showingDetour || !detourResult || selectedStops.length === 0 || !origin || !destination) return;
    const tour = buildTourFromState({
      origin,
      destination,
      mode,
      route: detourResult.route,
      distance_miles: detourResult.distance_miles,
      duration_seconds: detourResult.duration_seconds,
      stops: selectedStops,
    });
    setSavingTour(true);
    setSaveTourError(null);
    try {
      // Backend assigns the slug; client-side `slug` on the payload is ignored.
      const { slug } = await saveTour(tour);
      // `from: "build"` tells TourStoryMap to render a Back-to-map link
      // instead of Back-to-tours. Lost on refresh by design.
      navigate(`/tours/${slug}`, { state: { from: "build" } });
    } catch (e) {
      setSaveTourError(e instanceof Error ? e.message : "Could not save tour");
      setSavingTour(false);
    }
  }, [savingTour, showingDetour, detourResult, selectedStops, origin, destination, mode, navigate]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const stop of nearbyStops) {
      counts[stop.category] = (counts[stop.category] || 0) + 1;
    }
    return counts;
  }, [nearbyStops]);

  const filteredStops = useMemo(
    () => nearbyStops.filter((s) => activeCategories.has(s.category as PlaceCategory)),
    [nearbyStops, activeCategories],
  );

  if (!config) {
    return <div className="map-loading">Loading map…</div>;
  }

  const activeResult = showingDetour && detourResult ? detourResult : result;
  const showVerdictPanel = isLoading || result !== null || error !== null;
  const statusText =
    !showVerdictPanel && clickPhase === "set-origin"
      ? "Click to set your starting point"
      : !showVerdictPanel && clickPhase === "set-destination"
        ? "Now click your destination"
        : null;

  return (
    <div
      className={`map-wrapper ${isLoading ? "map-wrapper--loading" : ""}`}
    >
      <div ref={containerRef} className="map-container" />
      {statusText && mapReady && <div className="map-hint" key={statusText}>{statusText}</div>}
      {origin && (
        <div className="ring-legend">
          <button
            type="button"
            className={`ring-toggle${showRings ? " ring-toggle--active" : ""}`}
            onClick={() => setShowRings((v) => !v)}
          >
            <span className="ring-toggle__label">Distance</span>
            <span className="ring-toggle__switch" aria-hidden="true" />
          </button>
          <div className={`ring-legend__rows${showRings ? " ring-legend__rows--open" : ""}`}>
            <div className="ring-legend__rows-inner">
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
          </div>
        </div>
      )}
      <aside className="app-sidebar">
        <ModeToggle mode={mode} onChange={handleModeChange} />
        {!showVerdictPanel && (
          <div className="sidebar-intro">
            <h2>Explore Santa Fe {mode === "walk" ? "on foot" : "by car"}</h2>
            <p>
              Plan a {mode === "walk" ? "walk" : "drive"} and discover stops worth a detour — historic sites,
              galleries, landmarks, and scenic overlooks along your route.
            </p>
          </div>
        )}
        {showVerdictPanel && (
          <VerdictPanel
            distance_miles={activeResult?.distance_miles ?? 0}
            duration_seconds={activeResult?.duration_seconds ?? 0}
            within_limit={activeResult?.within_limit ?? false}
            limit_miles={effectiveMilesFor(mode)}
            isLoading={isLoading}
            error={error}
            onReset={handleReset}
            nearbyStops={filteredStops}
            selectedStops={selectedStops}
            stopLoading={stopLoading}
            stopError={stopError}
            onSelectStop={handleSelectStop}
            onFocusStop={handleFocusStop}
            activeCategories={activeCategories}
            onToggleCategory={handleToggleCategory}
            onToggleAllCategories={handleToggleAllCategories}
            categoryCounts={categoryCounts}
            detourLoading={detourLoading}
            showingDetour={showingDetour}
            mode={mode}
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
            showAllStops={showAllStops}
            onToggleShowAll={() => setShowAllStops((prev) => !prev)}
            onPlayTour={showingDetour && detourResult && selectedStops.length >= 1 ? handlePlayTour : null}
            savingTour={savingTour}
            saveTourError={saveTourError}
          />
        )}
      </aside>
    </div>
  );
}
