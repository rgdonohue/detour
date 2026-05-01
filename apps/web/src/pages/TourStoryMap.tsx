import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState, useReducer } from "react";
import { useParams, Link } from "react-router-dom";
import { getTour } from "../lib/tourApi";
import type { TourDefinition, PlaceCategory } from "../types/tour";

// ── Constants ─────────────────────────────────────────────────────────────────

const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const STOP_PITCH = 50;
const STOP_BEARING = -20;
const BUILDING_3D_LAYER = "tour-building-3d";

const ROUTE_COLOR = "#C45B28";
const ROUTE_SOURCE = "tour-route";
const ROUTE_LAYER = "tour-route-line";
const WALKED_SOURCE = "tour-route-walked";
const WALKED_LAYER = "tour-route-walked-line";

const EASE_OUT_QUAD = (t: number) => t * (2 - t);
const OVERVIEW_PADDING = { top: 60, bottom: 60, left: 400, right: 60 };
const OVERVIEW_PADDING_MOBILE = { top: 40, bottom: 280, left: 40, right: 40 };

function getOverviewPadding() {
  return window.innerWidth <= 768 ? OVERVIEW_PADDING_MOBILE : OVERVIEW_PADDING;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/** 0-based index of the route coordinate nearest to `target` (Euclidean lon/lat). */
function nearestRouteIndex(
  coords: number[][],
  target: [number, number]
): number {
  let nearest = 0;
  let minDist = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const dx = coords[i][0] - target[0];
    const dy = coords[i][1] - target[1];
    const d = dx * dx + dy * dy;
    if (d < minDist) {
      minDist = d;
      nearest = i;
    }
  }
  return nearest;
}

/**
 * Single-pass arc-length interpolation along coords[startIdx..endIdx] at t ∈ [0,1].
 * Returns both the interpolated camera center and the walked coordinate array
 * (coords[0..startIdx] + partial segment up to the interpolated point) so callers
 * don't need to recompute the same cumulative lengths twice per frame.
 */
function interpolateRouteProgress(
  coords: number[][],
  startIdx: number,
  endIdx: number,
  t: number
): { center: [number, number]; walked: number[][] } {
  // All route coords from the start up to (and including) the current stop
  const walked: number[][] = coords.slice(0, startIdx + 1);

  if (startIdx >= endIdx || t <= 0) {
    return { center: [coords[startIdx][0], coords[startIdx][1]], walked };
  }
  if (t >= 1) {
    return {
      center: [coords[endIdx][0], coords[endIdx][1]],
      walked: coords.slice(0, endIdx + 1),
    };
  }

  // Arc-length parameterization
  let totalLen = 0;
  const cumLen: number[] = [0];
  for (let i = startIdx + 1; i <= endIdx; i++) {
    const dx = coords[i][0] - coords[i - 1][0];
    const dy = coords[i][1] - coords[i - 1][1];
    totalLen += Math.sqrt(dx * dx + dy * dy);
    cumLen.push(totalLen);
  }

  if (totalLen === 0) {
    return { center: [coords[startIdx][0], coords[startIdx][1]], walked };
  }

  const targetLen = t * totalLen;
  for (let i = 1; i < cumLen.length; i++) {
    if (cumLen[i] >= targetLen) {
      const ci = startIdx + i;
      const frac = (targetLen - cumLen[i - 1]) / (cumLen[i] - cumLen[i - 1]);
      const lng =
        coords[ci - 1][0] + frac * (coords[ci][0] - coords[ci - 1][0]);
      const lat =
        coords[ci - 1][1] + frac * (coords[ci][1] - coords[ci - 1][1]);

      // Append integer-index coords from startIdx+1 to ci-1, then the lerped point
      for (let j = startIdx + 1; j < ci; j++) walked.push(coords[j]);
      walked.push([lng, lat]);

      return { center: [lng, lat], walked };
    }
  }

  return {
    center: [coords[endIdx][0], coords[endIdx][1]],
    walked: coords.slice(0, endIdx + 1),
  };
}

/** Push a new coordinate slice into the walked GeoJSON source. */
function setWalkedData(
  map: maplibregl.Map,
  coordinates: number[][]
): void {
  (map.getSource(WALKED_SOURCE) as maplibregl.GeoJSONSource | undefined)
    ?.setData({
      type: "Feature",
      geometry: { type: "LineString", coordinates },
      properties: {},
    } as unknown as GeoJSON.Feature);
}

// ── Types ─────────────────────────────────────────────────────────────────────

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; tour: TourDefinition };

function tourReducer(_: LoadState, action: LoadState): LoadState {
  return action;
}

const CATEGORY_LABELS: Record<PlaceCategory, string> = {
  history: "History",
  art: "Art",
  scenic: "Scenic",
  culture: "Culture",
  civic: "Civic",
};

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Derive chapter CSS class string given the active index. */
function chapterClass(
  base: string,
  chapterIndex: number,
  activeChapterIndex: number
): string {
  if (activeChapterIndex === chapterIndex) return `${base} story-map__chapter--active`;
  if (activeChapterIndex > chapterIndex) return `${base} story-map__chapter--passed`;
  return base;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TourStoryMap() {
  const { slug } = useParams<{ slug: string }>();
  const [state, dispatch] = useReducer(tourReducer, { status: "loading" });
  const [activeChapterIndex, setActiveChapterIndex] = useState<number>(0);

  // Narrative
  const chapterRefs = useRef<(HTMLElement | null)[]>([]);

  // Map
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const markerElemsRef = useRef<HTMLElement[]>([]);
  const boundsRef = useRef<[[number, number], [number, number]] | null>(null);
  const stopRouteIndicesRef = useRef<number[]>([]);
  const prevChapterRef = useRef<number>(0);

  // Scroll-driven camera
  const activeChapterIndexRef = useRef<number>(0);
  const scrollBlockedUntilRef = useRef<number>(0);
  const progressBarRef = useRef<HTMLDivElement>(null);

  // Stable refs updated each render
  const tourDataRef = useRef<TourDefinition | null>(null);
  if (state.status === "ok") tourDataRef.current = state.tour;
  activeChapterIndexRef.current = activeChapterIndex;

  // ── Fetch ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    dispatch({ status: "loading" });
    getTour(slug)
      .then((tour) => { if (!cancelled) dispatch({ status: "ok", tour }); })
      .catch((e: unknown) => {
        if (!cancelled) dispatch({
          status: "error",
          message: e instanceof Error ? e.message : "Failed to load tour",
        });
      });
    return () => { cancelled = true; };
  }, [slug]);

  // ── Map init + scroll listener ──────────────────────────────────────────────

  useEffect(() => {
    if (state.status !== "ok" || !mapContainerRef.current || mapRef.current)
      return;

    const { tour } = state;
    const routeCoords = tour.route.geometry.coordinates;
    const stopCount = tour.stops.length;

    // Bounds
    const lons = routeCoords.map((c) => c[0]);
    const lats = routeCoords.map((c) => c[1]);
    const sw: [number, number] = [Math.min(...lons), Math.min(...lats)];
    const ne: [number, number] = [Math.max(...lons), Math.max(...lats)];
    boundsRef.current = [sw, ne];

    // Nearest route coord for each stop — computed once, reused every frame
    stopRouteIndicesRef.current = tour.stops.map((stop) =>
      nearestRouteIndex(routeCoords, stop.coordinates)
    );

    // ── Map ──────────────────────────────────────────────────────────────────

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: BASEMAP_STYLE_URL,
      bounds: [sw, ne],
      fitBoundsOptions: { padding: getOverviewPadding(), pitch: 0, bearing: 0 },
    });

    map.keyboard.disable();

    map.on("load", () => {
      // ── 3D building extrusion ─────────────────────────────────────────────
      const style = map.getStyle();
      const buildingLayer = style.layers?.find(
        (l): l is maplibregl.LayerSpecification & { source: string; "source-layer"?: string } =>
          "source-layer" in l && (l as { "source-layer"?: string })["source-layer"] === "building"
      );
      if (buildingLayer && buildingLayer.source) {
        map.addLayer({
          id: BUILDING_3D_LAYER,
          type: "fill-extrusion",
          source: buildingLayer.source,
          "source-layer": "building",
          minzoom: 14,
          paint: {
            "fill-extrusion-color": "#d6cdbb",
            "fill-extrusion-height": [
              "coalesce",
              ["get", "render_height"],
              ["get", "height"],
              3,
            ],
            "fill-extrusion-base": [
              "coalesce",
              ["get", "render_min_height"],
              ["get", "min_height"],
              0,
            ],
            "fill-extrusion-opacity": 0.85,
          },
        });
      }

      // ── Ghost route (full path, dimmed as "path ahead") ───────────────────
      map.addSource(ROUTE_SOURCE, {
        type: "geojson",
        data: tour.route as unknown as GeoJSON.Feature,
      });
      map.addLayer({
        id: ROUTE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ROUTE_COLOR,
          "line-width": 4,
          "line-opacity": 0.25, // dimmed ghost
        },
      });

      // ── Walked route (progressive reveal, drawn on top) ───────────────────
      map.addSource(WALKED_SOURCE, {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [] },
          properties: {},
        } as unknown as GeoJSON.Feature,
      });
      map.addLayer({
        id: WALKED_LAYER,
        type: "line",
        source: WALKED_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ROUTE_COLOR,
          "line-width": 5,
          "line-opacity": 1,
        },
      });

      // Sync walked line to wherever the user already is if map loaded late
      const chapter = activeChapterIndexRef.current;
      if (chapter > 0) {
        const closingIdx = stopCount + 1;
        const walked =
          chapter >= closingIdx
            ? routeCoords
            : routeCoords.slice(
                0,
                stopRouteIndicesRef.current[Math.min(chapter - 1, stopCount - 1)] + 1
              );
        setWalkedData(map, walked);
      }

      // ── Numbered stop markers ─────────────────────────────────────────────
      const elems: HTMLElement[] = [];
      const markers: maplibregl.Marker[] = [];

      tour.stops.forEach((stop) => {
        const el = document.createElement("div");
        el.className = "tour-stop-marker";
        el.setAttribute("data-order", String(stop.order));
        el.title = stop.name;

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat(stop.coordinates)
          .addTo(map);

        elems.push(el);
        markers.push(marker);
      });

      markersRef.current = markers;
      markerElemsRef.current = elems;
    });

    mapRef.current = map;

    // ── Scroll listener ───────────────────────────────────────────────────────

    let rafId = 0;

    const handleScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const currentMap = mapRef.current;
        if (!currentMap) return;

        // Progress bar
        const maxScroll =
          document.documentElement.scrollHeight - window.innerHeight;
        if (maxScroll > 0 && progressBarRef.current) {
          progressBarRef.current.style.width = `${
            (window.scrollY / maxScroll) * 100
          }%`;
        }

        // Suppress during pitch/zoom-changing transitions
        if (Date.now() < scrollBlockedUntilRef.current) return;

        // Compute active chapter from scroll position (viewport midpoint)
        const halfVh = window.innerHeight / 2;
        let computedChapter = 0;
        chapterRefs.current.forEach((el, i) => {
          if (el && el.getBoundingClientRect().top <= halfVh) computedChapter = i;
        });
        if (computedChapter !== activeChapterIndexRef.current) {
          activeChapterIndexRef.current = computedChapter;
          setActiveChapterIndex(computedChapter);
        }

        // Only interpolate between stop chapters that have a following stop
        const chapter = computedChapter;
        if (chapter < 1 || chapter >= stopCount) return;

        const chapterEl = chapterRefs.current[chapter];
        if (!chapterEl) return;

        const rect = chapterEl.getBoundingClientRect();
        const progress = Math.max(
          0,
          Math.min(1, (window.innerHeight / 2 - rect.top) / rect.height)
        );

        const stopIdx = chapter - 1;
        const { walked } = interpolateRouteProgress(
          routeCoords,
          stopRouteIndicesRef.current[stopIdx],
          stopRouteIndicesRef.current[chapter], // next stop index (0-based)
          progress
        );

        setWalkedData(currentMap, walked);
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      cancelAnimationFrame(rafId);
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      markerElemsRef.current = [];
      boundsRef.current = null;
      stopRouteIndicesRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  // ── Discrete camera + walked line + marker pulse on chapter enter ───────────

  useEffect(() => {
    const map = mapRef.current;
    const tour = tourDataRef.current;
    if (!map || !tour) return;

    const closingIndex = tour.stops.length + 1;
    const prev = prevChapterRef.current;

    const isSpecialTransition =
      (prev === 0 && activeChapterIndex === 1) ||
      (prev === closingIndex - 1 && activeChapterIndex === closingIndex);

    const duration = isSpecialTransition ? 2000 : 1500;

    if (isSpecialTransition) {
      scrollBlockedUntilRef.current = Date.now() + duration;
    }

    prevChapterRef.current = activeChapterIndex;

    // ── Camera ──────────────────────────────────────────────────────────────

    if (activeChapterIndex === 0 || activeChapterIndex === closingIndex) {
      const bounds = boundsRef.current;
      if (!bounds) return;
      const camera = map.cameraForBounds(bounds, {
        padding: getOverviewPadding(),
        maxZoom: 14.5,
      });
      if (!camera || !camera.center) return;
      map.easeTo({
        center: camera.center as [number, number],
        zoom: camera.zoom,
        pitch: 0,
        bearing: 0,
        duration,
        easing: EASE_OUT_QUAD,
      });
    } else {
      const stop = tour.stops[activeChapterIndex - 1];
      if (!stop) return;
      map.easeTo({
        center: stop.coordinates,
        zoom: 16.5,
        pitch: STOP_PITCH,
        bearing: STOP_BEARING,
        offset: window.innerWidth <= 768 ? [0, -120] : [180, 0],
        duration,
        easing: EASE_OUT_QUAD,
      });
    }

    // ── Walked line — set to route progress at this chapter ─────────────────
    // The scroll handler handles continuous updates for chapters 1..stopCount-1;
    // this covers hero, last stop, and closing where scroll doesn't interpolate.

    const routeCoords = tour.route.geometry.coordinates;

    let walkedCoords: number[][];
    if (activeChapterIndex === 0) {
      walkedCoords = [];
    } else if (activeChapterIndex === closingIndex) {
      walkedCoords = routeCoords; // full route complete
    } else {
      const routeIdx = stopRouteIndicesRef.current[activeChapterIndex - 1];
      walkedCoords = routeCoords.slice(0, routeIdx + 1);
    }
    setWalkedData(map, walkedCoords);

    // ── Marker active class + pulse ─────────────────────────────────────────

    const activeStopIdx =
      activeChapterIndex >= 1 && activeChapterIndex <= tour.stops.length
        ? activeChapterIndex - 1
        : null;

    markerElemsRef.current.forEach((el, i) => {
      if (i === activeStopIdx) {
        el.classList.add("tour-stop-marker--active");

        // Re-trigger pulse even if marker was already active (scroll-back case)
        el.classList.remove("tour-stop-marker--pulsing");
        void el.offsetWidth; // force reflow to restart animation
        el.classList.add("tour-stop-marker--pulsing");
        el.addEventListener(
          "animationend",
          () => el.classList.remove("tour-stop-marker--pulsing"),
          { once: true }
        );
      } else {
        el.classList.remove("tour-stop-marker--active");
        el.classList.remove("tour-stop-marker--pulsing");
      }
    });
  }, [activeChapterIndex]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (state.status === "loading") {
    return (
      <div className="story-map story-map--loading">
        <Link to="/tours" className="story-map__back-link">
          ← Back to tours
        </Link>
        <div className="map-loading">Loading tour…</div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="story-map story-map--error">
        <Link to="/tours" className="story-map__back-link">
          ← Back to tours
        </Link>
        <div className="map-error">
          {state.message}
          <Link to="/tours" style={{ marginLeft: "0.5rem" }}>
            Browse tours
          </Link>
        </div>
      </div>
    );
  }

  const { tour } = state;
  const closingIndex = tour.stops.length + 1;

  return (
    <div className="story-map">
      <div ref={progressBarRef} className="story-map__progress-bar" />

      <Link to="/tours" className="story-map__back-link">
        ← Back to tours
      </Link>

      <div className="story-map__map-container">
        <div ref={mapContainerRef} className="map-container" />
      </div>

      <div className="story-map__narrative">
        {/* Hero */}
        <section
          className={chapterClass(
            "story-map__chapter story-map__chapter--hero",
            0,
            activeChapterIndex
          )}
          data-chapter-index={0}
          ref={(el) => { chapterRefs.current[0] = el; }}
        >
          <div className="story-map__chapter-card">
            <h1 className="story-map__tour-name">{tour.name}</h1>
            <p className="story-map__tagline">{tour.tagline}</p>
            <p className="story-map__description">{tour.description}</p>
            <div className="story-map__stats">
              <span className="story-map__stat">
                <span className="story-map__stat-value">{tour.stop_count}</span>
                <span className="story-map__stat-label">stops</span>
              </span>
              <span className="story-map__stat-divider">·</span>
              <span className="story-map__stat">
                <span className="story-map__stat-value">
                  {tour.distance_miles.toFixed(1)}
                </span>
                <span className="story-map__stat-label">mi</span>
              </span>
              <span className="story-map__stat-divider">·</span>
              <span className="story-map__stat">
                <span className="story-map__stat-value">
                  {formatDuration(tour.duration_minutes)}
                </span>
              </span>
              <span className="story-map__stat-divider">·</span>
              <span className="story-map__stat">
                <span className="story-map__stat-value">
                  {tour.mode === "walk" ? "Walking" : "Driving"}
                </span>
              </span>
            </div>
            <div className="story-map__scroll-hint">
              Scroll to explore
            </div>
          </div>
        </section>

        {/* Stop chapters */}
        {tour.stops.map((stop, i) => {
          const chapterIndex = i + 1;
          return (
            <section
              key={stop.order}
              className={chapterClass(
                "story-map__chapter",
                chapterIndex,
                activeChapterIndex
              )}
              data-chapter-index={chapterIndex}
              ref={(el) => { chapterRefs.current[chapterIndex] = el; }}
            >
              <div className="story-map__chapter-card">
                <div className="story-map__stop-header">
                  <span className="story-map__stop-number">{stop.order}</span>
                  <div className="story-map__stop-meta">
                    <h2 className="story-map__stop-name">{stop.name}</h2>
                    <span
                      className={`story-map__category-badge story-map__category-badge--${stop.category}`}
                    >
                      {CATEGORY_LABELS[stop.category]}
                    </span>
                  </div>
                </div>
                <p className="story-map__stop-description">
                  {stop.description}
                </p>
              </div>
            </section>
          );
        })}

        {/* Closing */}
        <section
          className={chapterClass(
            "story-map__chapter story-map__chapter--closing",
            closingIndex,
            activeChapterIndex
          )}
          data-chapter-index={closingIndex}
          ref={(el) => { chapterRefs.current[closingIndex] = el; }}
        >
          <div className="story-map__chapter-card">
            <h2 className="story-map__closing-title">
              Back where you started
            </h2>
            <p className="story-map__closing-summary">
              {tour.stop_count} stops and {tour.distance_miles.toFixed(1)} miles
              through 400 years of Santa Fe.
            </p>
            <div className="story-map__closing-links">
              <Link to="/tours" className="story-map__closing-link">
                Browse more tours
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
