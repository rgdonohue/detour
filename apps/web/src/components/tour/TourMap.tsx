import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useCallback } from "react";
import type { TourDefinition, TourStop } from "../../types/tour";

const TONER_LITE_URL =
  "https://tiles.stadiamaps.com/tiles/stamen_toner_lite/{z}/{x}/{y}.png";
const ROUTE_COLOR = "#C45B28";
const ROUTE_SOURCE = "tour-route";
const ROUTE_LAYER = "tour-route-line";

interface TourMapProps {
  tour: TourDefinition;
  activeStopIndex: number | null;
  onStopClick: (index: number) => void;
}

export function TourMap({ tour, activeStopIndex, onStopClick }: TourMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const markerElemsRef = useRef<HTMLElement[]>([]);

  const updateActiveMarker = useCallback((index: number | null) => {
    markerElemsRef.current.forEach((el, i) => {
      if (i === index) {
        el.classList.add("tour-stop-marker--active");
      } else {
        el.classList.remove("tour-stop-marker--active");
      }
    });
  }, []);

  const flyToStop = useCallback((stop: TourStop) => {
    if (!mapRef.current) return;
    mapRef.current.flyTo({
      center: stop.coordinates,
      zoom: Math.max(mapRef.current.getZoom(), 15.5),
      duration: 600,
    });
  }, []);

  // Init map on mount
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const coords = tour.route.geometry.coordinates;

    // Compute bounding box of the route
    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    const sw: [number, number] = [Math.min(...lons), Math.min(...lats)];
    const ne: [number, number] = [Math.max(...lons), Math.max(...lats)];

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          "stamen-toner-lite": {
            type: "raster",
            tiles: [TONER_LITE_URL],
            tileSize: 256,
            attribution:
              '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://stamen.com/">Stamen Design</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          },
        },
        layers: [
          {
            id: "stamen-toner-lite-layer",
            type: "raster",
            source: "stamen-toner-lite",
            minzoom: 0,
            maxzoom: 22,
          },
        ],
      },
      bounds: [sw, ne],
      fitBoundsOptions: { padding: { top: 48, bottom: 48, left: 48, right: 316 } },
    });

    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();

    map.on("load", () => {
      // Add route line
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
          "line-opacity": 0.9,
        },
      });

      // Add stop markers
      const elems: HTMLElement[] = [];
      const markers: maplibregl.Marker[] = [];

      tour.stops.forEach((stop, i) => {
        const el = document.createElement("div");
        el.className = "tour-stop-marker";
        el.setAttribute("data-order", String(stop.order));
        el.title = stop.name;

        el.addEventListener("click", () => {
          onStopClick(i);
        });

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

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      markerElemsRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally only on mount — tour data is stable

  // Sync active marker highlight
  useEffect(() => {
    updateActiveMarker(activeStopIndex);
  }, [activeStopIndex, updateActiveMarker]);

  // Fly to active stop
  useEffect(() => {
    if (activeStopIndex === null) return;
    const stop = tour.stops[activeStopIndex];
    if (stop) flyToStop(stop);
  }, [activeStopIndex, tour.stops, flyToStop]);

  return <div ref={containerRef} className="map-container" />;
}
