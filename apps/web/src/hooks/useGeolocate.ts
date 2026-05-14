import { useCallback, useEffect, useRef, useState } from "react";
import {
  computeGeolocateState,
  type GeolocateConfig,
  type GeolocateState,
} from "../lib/geo";

export interface UseGeolocateResult {
  state: GeolocateState;
  coords: [number, number] | null;
  request: () => void;
}

export function useGeolocate(config: GeolocateConfig): UseGeolocateResult {
  const [state, setState] = useState<GeolocateState>("idle");
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const configRef = useRef(config);
  configRef.current = config;

  const request = useCallback(() => {
    if (inFlightRef.current) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState("unavailable");
      return;
    }
    inFlightRef.current = true;
    setState("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!mountedRef.current) return;
        inFlightRef.current = false;
        const result = computeGeolocateState(
          { kind: "success", coords: [pos.coords.longitude, pos.coords.latitude] },
          configRef.current,
        );
        setState(result.state);
        setCoords(result.coords);
      },
      (err) => {
        if (!mountedRef.current) return;
        inFlightRef.current = false;
        const code = (err.code === 1 || err.code === 2 || err.code === 3
          ? err.code
          : 2) as 1 | 2 | 3;
        const result = computeGeolocateState(
          { kind: "error", code },
          configRef.current,
        );
        setState(result.state);
        setCoords(null);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  }, []);

  return { state, coords, request };
}
